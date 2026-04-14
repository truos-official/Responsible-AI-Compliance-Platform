#!/usr/bin/env python3
"""
Import Secretariat baseline requirements from an .xlsx file into the catalog admin endpoint.

Notes:
- Uses only Python stdlib for xlsx parsing (zip+xml), so no external deps are required.
- Upserts by (policy_title, jurisdiction, requirement_title) to avoid duplicate creation.
- Forces placement as Secretariat baseline (is_default=True across active apps).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

GOVERNANCE_CATEGORIES = {
    "Corporate Oversight",
    "Risk & Compliance",
    "Technical Architecture",
    "Data Readiness",
    "Data Integration",
    "Security",
    "Infrastructure",
    "Solution Design",
    "System Performance",
}

CATEGORY_MAP = {
    "Data Governance": "Data Integration",
}

MANUAL_MARKERS = {"", "manual", "n/a", "none", "na"}
SUPPORTED_SCOPES = {"secretariat", "application specific"}


@dataclass
class ImportRow:
    row_number: int
    requirement_scope: str
    policy_title: str
    policy_jurisdiction: str
    policy_source: str
    policy_description: str
    policy_type: str
    policy_status: str
    requirement_title: str
    requirement_description: str
    governance_category: str
    risk_statement: str
    control_measure_type: str
    metric_name: str | None
    metric_definition: str


def _col_idx(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch.upper()) - 64)
    return value - 1


def parse_xlsx_rows(xlsx_path: Path) -> list[dict[str, str]]:
    ns = {"a": NS_MAIN, "r": NS_REL}
    with zipfile.ZipFile(xlsx_path) as zf:
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship")
        }

        first_sheet = workbook.find("a:sheets", ns)[0]
        rid = first_sheet.attrib[f"{{{NS_REL}}}id"]
        target = rid_to_target[rid]
        sheet_path = target if target.startswith("xl/") else f"xl/{target}"

        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sst_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sst_root.findall("a:si", ns):
                text_parts = [t.text or "" for t in si.findall(".//a:t", ns)]
                shared_strings.append("".join(text_parts))

        sheet_root = ET.fromstring(zf.read(sheet_path))
        sheet_data = sheet_root.find(".//a:sheetData", ns)
        parsed_rows: list[list[str]] = []
        for row in sheet_data.findall("a:row", ns):
            temp: dict[int, str] = {}
            max_col = 0
            for cell in row.findall("a:c", ns):
                col = _col_idx(cell.attrib.get("r", "A1"))
                max_col = max(max_col, col)
                cell_type = cell.attrib.get("t")
                value_node = cell.find("a:v", ns)
                cell_value = ""
                if cell_type == "s" and value_node is not None and value_node.text is not None:
                    s_idx = int(value_node.text)
                    cell_value = shared_strings[s_idx] if 0 <= s_idx < len(shared_strings) else ""
                elif cell_type == "inlineStr":
                    text_node = cell.find("a:is/a:t", ns)
                    cell_value = text_node.text if text_node is not None and text_node.text else ""
                elif value_node is not None and value_node.text is not None:
                    cell_value = value_node.text
                temp[col] = cell_value
            parsed_rows.append([temp.get(i, "") for i in range(max_col + 1)])

    if not parsed_rows:
        return []

    header = [str(value or "").strip() for value in parsed_rows[0]]
    body = parsed_rows[1:]

    records: list[dict[str, str]] = []
    for row in body:
        if not any(str(v or "").strip() for v in row):
            continue
        data = {header[i]: str(row[i]).strip() if i < len(row) else "" for i in range(len(header))}
        records.append(data)
    return records


def normalize_row(record: dict[str, str], row_number: int) -> ImportRow:
    def get(field: str) -> str:
        return str(record.get(field, "") or "").strip()

    scope = get("Requirement Scope").lower()
    if not scope:
        scope = "secretariat"
    if scope not in SUPPORTED_SCOPES:
        raise ValueError(
            f"Row {row_number}: Requirement Scope must be Secretariat or Application Specific, got {scope!r}"
        )

    category_raw = get("Governance Category")
    category = CATEGORY_MAP.get(category_raw, category_raw)
    if category not in GOVERNANCE_CATEGORIES:
        raise ValueError(f"Row {row_number}: unsupported Governance Category {category_raw!r}")

    source_raw = get("Measurement Source").lower()
    if "telemetry" in source_raw:
        control_measure_type = "system_telemetry"
    elif "manual" in source_raw or "evidence" in source_raw:
        control_measure_type = "evidence_based"
    else:
        control_measure_type = "system_telemetry" if get("Metric Name") else "evidence_based"

    metric_name_raw = get("Metric Name")
    metric_name = metric_name_raw if metric_name_raw.lower() not in MANUAL_MARKERS else None
    if control_measure_type == "evidence_based" and not metric_name:
        slug = re.sub(r"[^a-z0-9]+", "_", get("Requirement Title").lower()).strip("_")
        metric_name = f"manual.evidence.{slug[:80] or 'requirement'}"

    return ImportRow(
        row_number=row_number,
        requirement_scope=scope,
        policy_title=get("Policy Title")[:280],
        policy_jurisdiction=get("Policy Jurisdiction")[:120],
        policy_source=get("Policy Source")[:200],
        policy_description=get("Policy Description")[:4000],
        policy_type=get("Policy Type")[:120],
        policy_status=get("Policy Status")[:40],
        requirement_title=get("Requirement Title")[:280],
        requirement_description=get("Requirement Description")[:1200],
        governance_category=category,
        risk_statement=get("Primary Risk Statement")[:1000],
        control_measure_type=control_measure_type,
        metric_name=metric_name,
        metric_definition=get("Metric Definition"),
    )


def api_request(base_url: str, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{base_url.rstrip('/')}{path}"
    headers = {
        "Content-Type": "application/json",
        "X-Governance-Scopes": "governance.admin",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed ({exc.code}): {body}") from exc


def fetch_all_requirements(base_url: str) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    skip = 0
    limit = 200
    while True:
        path = f"/catalog/requirements?skip={skip}&limit={limit}"
        payload = api_request(base_url, "GET", path)
        items = payload.get("items", []) if isinstance(payload, dict) else []
        all_rows.extend(items)
        if len(items) < limit:
            break
        skip += limit
    return all_rows


def fetch_all_regulations(base_url: str) -> list[dict[str, Any]]:
    payload = api_request(base_url, "GET", "/catalog/regulations?skip=0&limit=500")
    return payload.get("items", []) if isinstance(payload, dict) else []


def fetch_active_application_ids(base_url: str) -> list[str]:
    payload = api_request(base_url, "GET", "/applications")
    items = payload if isinstance(payload, list) else []
    ids: list[str] = []
    for item in items:
        app_id = str(item.get("id") or "").strip()
        status = str(item.get("status") or "").strip().lower()
        if not app_id or status == "disconnected":
            continue
        ids.append(app_id)
    return ids


def key_for_requirement(policy_title: str, jurisdiction: str, requirement_title: str) -> tuple[str, str, str]:
    return (policy_title.strip().lower(), jurisdiction.strip().lower(), requirement_title.strip().lower())


def run_import(xlsx_path: Path, base_url: str) -> int:
    source_rows = parse_xlsx_rows(xlsx_path)
    normalized: list[ImportRow] = []
    for idx, row in enumerate(source_rows, start=2):
        try:
            normalized.append(normalize_row(row, idx))
        except ValueError as exc:
            print(f"SKIP: {exc}")

    deduped_by_key: dict[tuple[str, str, str], ImportRow] = {}
    duplicate_rows = 0
    for row in normalized:
        req_key = key_for_requirement(row.policy_title, row.policy_jurisdiction, row.requirement_title)
        if req_key in deduped_by_key:
            duplicate_rows += 1
        deduped_by_key[req_key] = row
    deduped_rows = list(deduped_by_key.values())

    requirements = fetch_all_requirements(base_url)
    existing_req_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for req in requirements:
        key = key_for_requirement(
            str(req.get("regulation_title") or ""),
            str(req.get("jurisdiction") or ""),
            str(req.get("title") or ""),
        )
        existing_req_by_key[key] = req

    regulations = fetch_all_regulations(base_url)
    regulation_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for reg in regulations:
        k = (str(reg.get("title") or "").strip().lower(), str(reg.get("jurisdiction") or "").strip().lower())
        regulation_by_key[k] = reg
    active_app_ids = fetch_active_application_ids(base_url)

    created = 0
    updated = 0
    failed = 0

    for row in deduped_rows:
        req_key = key_for_requirement(row.policy_title, row.policy_jurisdiction, row.requirement_title)
        existing_req = existing_req_by_key.get(req_key)
        existing_reg = regulation_by_key.get((row.policy_title.strip().lower(), row.policy_jurisdiction.strip().lower()))
        is_baseline = row.requirement_scope == "secretariat"
        if is_baseline:
            placement = {
                "requirement_type": "baseline",
                "dashboard_inclusion": "baseline",
                "application_ids": [],
                "apply_to_all_apps": True,
            }
        else:
            if not active_app_ids:
                failed += 1
                print(
                    f"FAILED row {row.row_number} ({row.requirement_title}): "
                    "no active applications available for application-specific assignment"
                )
                continue
            placement = {
                "requirement_type": "application_specific",
                "dashboard_inclusion": "assigned",
                "application_ids": active_app_ids,
                "apply_to_all_apps": False,
            }

        payload: dict[str, Any] = {
            "requirement_id": existing_req.get("id") if existing_req else None,
            "policy_id": existing_reg.get("id") if existing_reg else None,
            "policy_title": row.policy_title,
            "policy_jurisdiction": row.policy_jurisdiction,
            "policy_source": row.policy_source,
            "policy_description": row.policy_description,
            "policy_type": row.policy_type,
            "policy_status": row.policy_status,
            "requirement_title": row.requirement_title,
            "requirement_description": row.requirement_description,
            "governance_category": row.governance_category,
            "risk_statement": row.risk_statement,
            "control_title": row.requirement_title,
            "control_description": row.requirement_description,
            "control_measure_type": row.control_measure_type,
            "metric_name": row.metric_name,
            "formula_expression": row.metric_definition or None,
            "placement": placement,
            "set_by": "secretariat_bulk_import",
        }

        try:
            result = api_request(base_url, "POST", "/catalog/admin/requirements/save", payload)
            if existing_req:
                updated += 1
                print(f"UPDATED: {row.requirement_title} -> {result.get('requirement_id')}")
            else:
                created += 1
                print(f"CREATED: {row.requirement_title} -> {result.get('requirement_id')}")
            existing_req_by_key[req_key] = {
                "id": result.get("requirement_id"),
                "title": row.requirement_title,
                "regulation_title": row.policy_title,
                "jurisdiction": row.policy_jurisdiction,
            }
        except Exception as exc:
            failed += 1
            print(f"FAILED row {row.row_number} ({row.requirement_title}): {exc}")

    print(
        f"IMPORT COMPLETE | source_rows={len(source_rows)} normalized={len(normalized)} deduped={len(deduped_rows)} "
        f"duplicates_in_file={duplicate_rows} "
        f"created={created} updated={updated} failed={failed}"
    )
    return 0 if failed == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Secretariat requirements from xlsx.")
    parser.add_argument(
        "--xlsx",
        required=True,
        help="Absolute path to Governance_Requirements_Secretariat.xlsx",
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000/api/v1",
        help="API base URL",
    )
    args = parser.parse_args()
    return run_import(Path(args.xlsx), args.base_url)


if __name__ == "__main__":
    sys.exit(main())
