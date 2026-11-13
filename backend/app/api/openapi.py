"""D94: the OpenAPI describes the 422 that the API really sends.

FastAPI adds to every route with input a 422 with its own `HTTPValidationError`
(`{"detail": [...]}`), but the handler of app/api/errors.py answers with a
problem that lists the fields in `errors`. The document is fixed in one place,
so no route has to declare it.
"""

from typing import Any

from fastapi import FastAPI
from pydantic.json_schema import models_json_schema

from app.schemas.problems import ValidationProblem

SCHEMAS_PREFIX = "#/components/schemas/"
FRAMEWORK_SCHEMAS = ("HTTPValidationError", "ValidationError")
VALIDATION_DESCRIPTION = "VALIDATION_ERROR, com os campos recusados em `errors`"


def use_validation_problem(document: dict[str, Any]) -> dict[str, Any]:
    """Points every 422 to `ValidationProblem` and drops the framework's schema."""
    _, definitions = models_json_schema(
        [(ValidationProblem, "serialization")],
        ref_template=SCHEMAS_PREFIX + "{model}",
    )
    framework_ref = SCHEMAS_PREFIX + FRAMEWORK_SCHEMAS[0]
    for operations in document["paths"].values():
        for operation in operations.values():
            response = operation["responses"].get("422")
            if response is None:
                continue
            schema = response["content"]["application/json"]["schema"]
            if schema.get("$ref") == framework_ref:
                schema["$ref"] = SCHEMAS_PREFIX + ValidationProblem.__name__
                response["description"] = VALIDATION_DESCRIPTION

    schemas = document["components"]["schemas"]
    for name in FRAMEWORK_SCHEMAS:
        schemas.pop(name, None)
    schemas.update(definitions["$defs"])
    # The same alphabetical order FastAPI uses, so the export stays stable (D51).
    document["components"]["schemas"] = dict(sorted(schemas.items()))
    return document


class AgendaApi(FastAPI):
    def openapi(self) -> dict[str, Any]:
        if self.openapi_schema is None:
            self.openapi_schema = use_validation_problem(super().openapi())
        return self.openapi_schema
