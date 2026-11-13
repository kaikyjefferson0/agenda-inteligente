"""D94: the OpenAPI declares every response with a body of its own.

The real bodies are checked against these schemas in
tests/configuration/test_problem_bodies.py.
"""

from typing import Any

from app.main import app

REF = "#/components/schemas/"
PROFESSIONAL = "/api/v1/professionals/{professional_id}"


def document() -> dict[str, Any]:
    return app.openapi()


def schema_of(path: str, method: str, status: str) -> dict[str, Any]:
    response = document()["paths"][path][method]["responses"][status]
    return response["content"]["application/json"]["schema"]


def operations() -> list[tuple[str, str, dict[str, Any]]]:
    return [
        (path, method, operation)
        for path, methods in document()["paths"].items()
        for method, operation in methods.items()
    ]


def test_the_framework_validation_error_is_gone() -> None:
    schemas = document()["components"]["schemas"]

    assert "HTTPValidationError" not in schemas
    assert "ValidationError" not in schemas
    assert "HTTPValidationError" not in str(document())


def test_every_422_is_the_problem_the_api_sends() -> None:
    with_422 = [
        (path, method, operation["responses"]["422"])
        for path, method, operation in operations()
        if "422" in operation["responses"]
    ]

    assert with_422
    for path, method, response in with_422:
        schema = response["content"]["application/json"]["schema"]
        assert schema == {"$ref": f"{REF}ValidationProblem"}, (path, method)
    problem = document()["components"]["schemas"]["ValidationProblem"]
    assert problem["required"] == [
        "type",
        "title",
        "status",
        "code",
        "detail",
        "errors",
    ]
    assert problem["properties"]["errors"]["items"] == {"$ref": f"{REF}FieldErrorData"}


def test_routes_without_input_have_no_422() -> None:
    for path, method in [("/api/v1/auth/me", "get"), ("/api/v1/business", "get")]:
        assert "422" not in document()["paths"][path][method]["responses"]


def test_the_409_of_a_block_is_told_apart_by_code() -> None:
    schema = schema_of(f"{PROFESSIONAL}/time-blocks", "post", "409")

    assert schema["oneOf"] == [
        {"$ref": f"{REF}AppointmentConflictsProblem"},
        {"$ref": f"{REF}TimeBlockOverlapProblem"},
    ]
    assert schema["discriminator"] == {
        "propertyName": "code",
        "mapping": {
            "APPOINTMENT_CONFLICTS": f"{REF}AppointmentConflictsProblem",
            "TIME_BLOCK_OVERLAP": f"{REF}TimeBlockOverlapProblem",
        },
    }
    conflicts = document()["components"]["schemas"]["AppointmentConflictsProblem"]
    assert "conflicts" in conflicts["required"]
    assert conflicts["properties"]["conflicts"]["items"] == {
        "$ref": f"{REF}AppointmentData"
    }


def test_the_409_of_a_deactivation_lists_the_appointments() -> None:
    schema = schema_of(f"{PROFESSIONAL}/deactivate", "post", "409")

    assert schema == {"$ref": f"{REF}AppointmentConflictsProblem"}


def test_success_bodies_of_200_are_declared() -> None:
    me = "/api/v1/professionals/me"
    booking = "/api/v1/public/businesses/{slug}/appointments"

    assert schema_of(me, "post", "200") == schema_of(me, "post", "201")
    assert schema_of(me, "post", "200") == {"$ref": f"{REF}ProfessionalData"}
    assert schema_of(booking, "post", "200") == {"$ref": f"{REF}BookingResponse"}


def test_health_declares_only_its_body() -> None:
    assert schema_of("/health", "get", "200") == {"$ref": f"{REF}HealthResponse"}
    assert set(document()["paths"]["/health"]["get"]["responses"]) == {"200"}


def test_ready_declares_its_body_and_the_503() -> None:
    assert schema_of("/ready", "get", "200") == {"$ref": f"{REF}ReadyResponse"}
    assert schema_of("/ready", "get", "503") == {"$ref": f"{REF}Problem"}
    problem = document()["components"]["schemas"]["Problem"]
    assert problem["properties"]["code"] == {"$ref": f"{REF}ErrorCode"}
    codes = document()["components"]["schemas"]["ErrorCode"]["enum"]
    assert "INVITATION_NOT_PENDING" in codes


def test_cancelling_an_invitation_is_a_delete_without_body() -> None:
    operation = document()["paths"][f"{PROFESSIONAL}/invitation"]["delete"]

    assert set(operation["responses"]) == {"204", "422"}
    assert "content" not in operation["responses"]["204"]


def test_the_professional_tells_when_the_invite_expires_without_the_token() -> None:
    professional = document()["components"]["schemas"]["ProfessionalData"]

    assert "invitation_expires_at" in professional["required"]
    assert professional["properties"]["invitation_expires_at"]["anyOf"] == [
        {"type": "string", "format": "date-time"},
        {"type": "null"},
    ]
    assert not [name for name in professional["properties"] if "token" in name]


def test_the_export_is_cached_and_stable() -> None:
    assert app.openapi() is app.openapi()
    names = list(document()["components"]["schemas"])
    assert names == sorted(names)
