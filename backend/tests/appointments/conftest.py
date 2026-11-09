"""The fixtures of the public phase: a business, a service and two professionals.

`pro` and `colleague` serve the service on Mondays from 09:00 to 18:00, and
`other_business` has its own service and professional.
"""

from tests.public.conftest import (  # noqa: F401
    colleague,
    monday_10,
    other_business,
    owner_token,
    pro,
    service,
)
