import enum


class VirusScanResult(enum.StrEnum):
    PENDING = "pending"
    CLEAN = "clean"
    INFECTED = "infected"
    ERROR = "error"  # scanner unavailable / failed — retryable, not a threat
    SKIPPED = "skipped"  # e.g. for embedded videos or links
