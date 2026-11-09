from app.core.config import Settings
from app.email.fake import FakeSender
from app.email.resend import ResendSender
from app.email.sender import EmailSender
from app.email.smtp import SmtpSender


def build_sender(settings: Settings) -> EmailSender:
    """D34: the adapter named by EMAIL_BACKEND."""
    match settings.email_backend:
        case "smtp":
            return SmtpSender(
                settings.smtp_host, settings.smtp_port, settings.email_from
            )
        case "fake":
            return FakeSender()
        case "resend":
            # Settings refuses to start without the key, so it is never None here.
            assert settings.resend_api_key is not None
            return ResendSender(
                settings.resend_api_key.get_secret_value(), settings.email_from
            )
