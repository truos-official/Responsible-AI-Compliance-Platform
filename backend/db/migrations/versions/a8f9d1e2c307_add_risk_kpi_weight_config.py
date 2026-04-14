"""add_risk_kpi_weight_config

Revision ID: a8f9d1e2c307
Revises: f6d8b0c2d506
Create Date: 2026-04-10 13:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a8f9d1e2c307"
down_revision: Union[str, Sequence[str], None] = "f6d8b0c2d506"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "risk_kpi_weight_config",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("kpi_weights", sa.JSON(), nullable=False),
        sa.Column("set_by", sa.String(), nullable=False),
        sa.Column("set_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_risk_kpi_weight_config_active_set_at",
        "risk_kpi_weight_config",
        ["is_active", "set_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_risk_kpi_weight_config_active_set_at", table_name="risk_kpi_weight_config")
    op.drop_table("risk_kpi_weight_config")

