from pydantic import BaseModel


class ChatRequest(BaseModel):
    messages: list[dict]  # [{role, content}]
    company: str | None = None  # optional scope filter


class CompareRequest(BaseModel):
    company_a: str
    company_b: str
    dimensions: list[str] | None = None
