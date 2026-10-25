"""Dependency-free timestamps and redaction shared by remote readers and API validation."""
import datetime as dt
import re

def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def timestamp(value):
    if not value:
        return None
    try:
        result = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result if result.tzinfo else None
    except ValueError:
        return None


def redact(value):
    text = str(value)
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    text = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)", "[REDACTED KEY]", text)
    text = re.sub(r'''(?i)(["'](?:authorization|cookie|set-cookie)["']\s*:\s*)(["'])(.*?)\2''', lambda m: m[1]+m[2]+'[REDACTED]'+m[2], text)
    text = re.sub(r'(?im)(\b(?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+', r'\1[REDACTED]', text)
    text = re.sub(r"(?i)(authorization\s*[:=]\s*)(?:bearer|basic)?\s*[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(r'''(?i)((?:password|passwd|token|secret|api[_-]?key|cookie|set-cookie)\s*["']?\s*[:=]\s*["']?)[^\s,;"']+''', r"\1[REDACTED]", text)
    text = re.sub(r"\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b", "[REDACTED]", text)
    text = re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[REDACTED]@", text)
    text = re.sub(r"https://(?:discord(?:app)?\.com)/api/webhooks/[^\s]+", "[REDACTED WEBHOOK]", text)
    return "".join(c for c in text if c in "\n\t" or ord(c) >= 32)[:8000]
