"""add_policy_and_risk_fields

Revision ID: b9e1f2a4c601
Revises: a8f9d1e2c307
Create Date: 2026-04-12 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b9e1f2a4c601"
down_revision: Union[str, Sequence[str], None] = "a8f9d1e2c307"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("regulation", sa.Column("source", sa.String(), nullable=True))
    op.add_column("regulation", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("regulation", sa.Column("policy_type", sa.String(), nullable=True))
    op.add_column("regulation", sa.Column("policy_status", sa.String(), nullable=True))
    op.add_column("requirement", sa.Column("risk_statement", sa.Text(), nullable=True))

    op.execute("UPDATE regulation SET policy_status = 'Active' WHERE policy_status IS NULL")


def downgrade() -> None:
    op.drop_column("requirement", "risk_statement")
    op.drop_column("regulation", "policy_status")
    op.drop_column("regulation", "policy_type")
    op.drop_column("regulation", "description")
    op.drop_column("regulation", "source")

