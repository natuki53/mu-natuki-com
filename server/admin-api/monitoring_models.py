"""Versioned, bounded observations. Raw configs, environment and secrets are never fields."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


from monitoring_common import utcnow, timestamp, redact


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Disk(StrictModel):
    path: str = Field(max_length=512)
    totalBytes: int | None = Field(default=None, ge=0)
    usedBytes: int | None = Field(default=None, ge=0)
    freeBytes: int | None = Field(default=None, ge=0)
    mounted: bool | None = None
    uuidMatches: bool | None = None
    smart: Literal["passed", "failed", "unknown"] = "unknown"


class DiskVolume(StrictModel):
    device: str = Field(max_length=512)
    kind: str = Field(max_length=32)
    sizeBytes: int | None = Field(default=None, ge=0)
    filesystem: str | None = Field(default=None, max_length=80)
    label: str | None = Field(default=None, max_length=128)
    mountpoints: list[str] = Field(default_factory=list, max_length=32)
    mounted: bool = False
    container: bool = False
    shared: bool = False
    totalBytes: int | None = Field(default=None, ge=0)
    usedBytes: int | None = Field(default=None, ge=0)
    freeBytes: int | None = Field(default=None, ge=0)


class PhysicalDisk(StrictModel):
    device: str = Field(max_length=512)
    kind: Literal['ssd','hdd','nvme','usb','optical','unknown'] = 'unknown'
    model: str | None = Field(default=None, max_length=128)
    transport: str | None = Field(default=None, max_length=32)
    removable: bool = False
    sizeBytes: int | None = Field(default=None, ge=0)
    volumes: list[DiskVolume] = Field(default_factory=list, max_length=128)


class Service(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    name: str = Field(max_length=120)
    kind: Literal["docker", "systemd"]
    state: Literal["running", "stopped", "failed", "restarting", "unknown"]
    health: Literal["healthy", "unhealthy", "starting", "unknown"] = "unknown"
    restarts: int | None = Field(default=None, ge=0)
    startedAt: str | None = Field(default=None, max_length=80)
    error: str | None = Field(default=None, max_length=500)
    expectedState: Literal['running','stopped','unknown'] = 'running'
    logsEnabled: bool = False


class LogEntry(StrictModel):
    serviceId: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    at: str = Field(max_length=80)
    level: Literal["debug", "info", "warning", "error"] = "info"
    message: str = Field(max_length=16000)

    @field_validator("at")
    @classmethod
    def valid_date(cls, value):
        if not timestamp(value):
            raise ValueError("timestamp must contain timezone")
        return value

    @field_validator("message")
    @classmethod
    def safe_message(cls, value):
        return redact(value)


class Snapshot(StrictModel):
    id: str = Field(pattern=r"^[a-f0-9]{8,64}$")
    sourceId: str | None = Field(default=None, pattern=r"^[a-f0-9]{8,64}$")
    kind: Literal["full", "db", "unknown"]
    complete: bool
    time: str = Field(max_length=80)

    @field_validator("time")
    @classmethod
    def valid_date(cls, value):
        return LogEntry.valid_date(value)


class Job(StrictModel):
    kind: Literal["full", "db", "copy", "check", "deep-check", "restore", "retention"]
    phase: Literal["idle", "running", "failed", "unknown"] = "unknown"
    lastSuccessAt: str | None = Field(default=None, max_length=80)
    lastFailureAt: str | None = Field(default=None, max_length=80)
    snapshotId: str | None = Field(default=None, max_length=64)
    nextRunAt: str | None = Field(default=None, max_length=80)
    scheduleMode: Literal['scheduled','on-copy-change','manual','disabled','after-run','unknown'] = 'unknown'
    readData: bool | None = None
    error: str | None = Field(default=None, max_length=500)
    maxAgeHours: float | None = Field(default=None, gt=0)

    @field_validator('error')
    @classmethod
    def safe_error(cls,value):
        return redact(value)[:500] if value else value


class Backup(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    name: str = Field(max_length=120)
    role: Literal["primary", "secondary", "archive"]
    repository: str = Field(max_length=512)
    measuredAt: str = Field(max_length=80)
    status: Literal["ok", "unknown", "failed"] = "unknown"
    error: str | None = Field(default=None, max_length=500)
    disk: Disk
    repositoryBytes: int | None = Field(default=None, ge=0)
    workBytes: int | None = Field(default=None, ge=0)
    restoreBytes: int | None = Field(default=None, ge=0)
    minimumFreeBytes: int = Field(default=0, ge=0)
    retention: dict[str, int] = Field(default_factory=dict, max_length=8)
    maxSnapshotAgeHours: dict[str, float] = Field(default_factory=lambda: {'full': 30, 'db': 9}, max_length=2)
    snapshots: list[Snapshot] = Field(default_factory=list, max_length=5000)
    jobs: list[Job] = Field(default_factory=list, max_length=6)


class Machine(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    state: str = Field(max_length=80)
    vcpus: int = Field(ge=0)
    memoryKiB: int = Field(ge=0)
    autostart: str = Field(max_length=20)


class Observation(StrictModel):
    version: Literal[1] = 1
    hostId: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,60}$")
    measuredAt: str = Field(max_length=80)
    cpuPct: float | None = Field(default=None, ge=0, le=100)
    memoryPct: float | None = Field(default=None, ge=0, le=100)
    uptimeSeconds: float | None = Field(default=None, ge=0)
    temperatureC: float | None = Field(default=None, ge=-30, le=150)
    disks: list[Disk] = Field(default_factory=list, max_length=20)
    physicalDisks: list[PhysicalDisk] = Field(default_factory=list, max_length=64)
    diskInventoryStatus: Literal['ok','unknown','error'] = 'unknown'
    machines: list[Machine] = Field(default_factory=list, max_length=20)
    machinesStatus: Literal['ok','unknown','error'] = 'unknown'
    services: list[Service] = Field(default_factory=list, max_length=100)
    servicesMeasuredAt: str | None = Field(default=None, max_length=80)
    logs: list[LogEntry] = Field(default_factory=list, max_length=1000)
    backups: list[Backup] = Field(default_factory=list, max_length=10)
    errors: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("measuredAt")
    @classmethod
    def valid_date(cls, value):
        return LogEntry.valid_date(value)
