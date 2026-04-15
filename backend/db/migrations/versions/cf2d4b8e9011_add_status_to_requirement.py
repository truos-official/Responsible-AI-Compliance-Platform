"""add_status_to_requirement

Revision ID: cf2d4b8e9011
Revises: b9e1f2a4c601
Create Date: 2026-04-14 11:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "cf2d4b8e9011"
down_revision: Union[str, Sequence[str], None] = "b9e1f2a4c601"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requirement",
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'Active'")),
    )

    # Backfill requirement status from current linked regulation policy status when available.
    op.execute(
        """
        UPDATE requirement r
        SET status = COALESCE(NULLIF(TRIM(reg.policy_status), ''), 'Active')
        FROM regulation reg
        WHERE reg.id = r.regulation_id
          AND (r.status IS NULL OR TRIM(r.status) = '')
        """
    )


def downgrade() -> None:
    op.drop_column("requirement", "status")

