"""Read-only Linux probe streamed over SSH stdin; no install or remote files."""
import datetime as dt
import json
from pathlib import Path
import subprocess
import time


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=12, check=True)
    if len(result.stdout) > 2_000_000:
        raise ValueError('Response too large')
    return result.stdout


def sample():
    values = [int(n) for n in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]


def probe():
    errors = []
    first = sample()
    time.sleep(.25)
    last = sample()
    elapsed = last[0] - first[0]
    memory = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
    result = {'measuredAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'hostname': Path('/proc/sys/kernel/hostname').read_text().strip(),
              'cpuPct': round(100 * (1 - (last[1]-first[1])/elapsed), 1) if elapsed else None,
              'memoryPct': round(100 * (1-memory['MemAvailable']/memory['MemTotal']), 1),
              'uptimeSeconds': float(Path('/proc/uptime').read_text().split()[0]), 'errors': errors}
    try:
        result['blockdevices'] = json.loads(command(['lsblk', '--json', '--bytes', '--tree', '--output',
            'NAME,PATH,TYPE,SIZE,ROTA,RM,TRAN,MODEL,FSTYPE,LABEL,MOUNTPOINTS,FSSIZE,FSUSED,FSAVAIL,MAJ:MIN']))['blockdevices']
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        errors.append('Disk inventory unavailable')
    try:
        names = command(['virsh', '-c', 'qemu:///system', 'list', '--all', '--name']).splitlines()
        result['machines'] = []
        for name in [n.strip() for n in names if n.strip()][:20]:
            details = command(['virsh', '-c', 'qemu:///system', 'dominfo', name])
            fields = dict(line.split(':', 1) for line in details.splitlines() if ':' in line)
            result['machines'].append({'name': name, 'state': fields.get('State', '').strip(),
                'vcpus': int(fields.get('CPU(s)', '0')), 'memoryKiB': int(fields.get('Max memory', '0').split()[0]),
                'autostart': fields.get('Autostart', '').strip()})
        result['machinesStatus'] = 'ok'
    except (OSError, ValueError, subprocess.SubprocessError):
        result['machinesStatus'] = 'error'
        errors.append('VM inventory unavailable')
    return result


if __name__ == '__main__':
    print(json.dumps(probe()))
