"""Physical Linux block devices and their volumes; never sums shared filesystems."""
from collections import Counter
import json
import re


LSBLK_COLUMNS = 'NAME,PATH,TYPE,SIZE,ROTA,RM,TRAN,MODEL,FSTYPE,LABEL,MOUNTPOINTS,FSSIZE,FSUSED,FSAVAIL,MAJ:MIN'


def number(value):
    if value is None or value == '':
        return None
    result = int(value)
    return result if result >= 0 else None


def flag(value):
    if value in (True, 1, '1', 'true'):
        return True
    if value in (False, 0, '0', 'false'):
        return False
    return None


def media_kind(node):
    if node.get('type') == 'rom':
        return 'optical'
    transport = node.get('tran')
    if transport == 'nvme':
        return 'nvme'
    if transport == 'usb':
        return 'usb'
    if flag(node.get('rota')) is True:
        return 'hdd'
    if flag(node.get('rota')) is False:
        return 'ssd'
    return 'unknown'


def parse_inventory(payload):
    nodes = payload.get('blockdevices')
    if not isinstance(nodes, list):
        raise ValueError('Invalid block device inventory')
    disks = {}
    for node in nodes:
        if node.get('type') not in ('disk', 'rom'):
            continue  # loop, zram and other virtual backing devices are not physical disks.
        device = node.get('path')
        if not device or not device.startswith('/dev/'):
            raise ValueError('Invalid physical device path')
        if re.fullmatch(r'/dev/(?:zram|ram)\d+', device):
            continue
        disk = disks.setdefault(device, {
            'device': device, 'kind': media_kind(node), 'model': (node.get('model') or '').strip() or None,
            'transport': node.get('tran'), 'removable': flag(node.get('rm')) is True,
            'sizeBytes': number(node.get('size')), 'volumes': [],
        })
        seen = {v['device'] for v in disk['volumes']}
        stack = [node]
        walked = 0
        while stack:
            child = stack.pop(0)
            walked += 1
            if walked > 4096:
                raise ValueError('Block device tree exceeds limit')
            stack.extend(child.get('children') or [])
            path = child.get('path')
            if not path or path in seen:
                continue
            # A filesystem may live directly on a whole disk, without partitions.
            if child is node and not child.get('fstype') and not any(child.get('mountpoints') or []):
                continue
            seen.add(path)
            mountpoints = list(dict.fromkeys(p for p in child.get('mountpoints', []) or [] if isinstance(p, str) and p.startswith('/')))
            mounted = bool(mountpoints)
            disk['volumes'].append({
                'device': path, 'kind': child.get('type', 'unknown'), 'sizeBytes': number(child.get('size')),
                'filesystem': child.get('fstype'), 'label': child.get('label'), 'mountpoints': mountpoints,
                'mounted': mounted, 'container': bool(child.get('children')) and not mounted, 'shared': False,
                # Missing or unmounted usage is unknown, never zero or the parent filesystem's usage.
                'totalBytes': number(child.get('fssize')) if mounted else None,
                'usedBytes': number(child.get('fsused')) if mounted else None,
                'freeBytes': number(child.get('fsavail')) if mounted else None,
            })
        if len(disk['volumes']) > 128:
            raise ValueError('Volume inventory exceeds limit')
    if len(disks) > 64:
        raise ValueError('Physical disk inventory exceeds limit')
    references = Counter(v['device'] for disk in disks.values() for v in disk['volumes'])
    for disk in disks.values():
        for volume in disk['volumes']:
            volume['shared'] = references[volume['device']] > 1
    return list(disks.values())


def collect_disks(run):
    # Explicit columns provide a stable contract. No serial numbers, mounting or mutations.
    raw = run(['lsblk', '--json', '--bytes', '--tree', '--output', LSBLK_COLUMNS], timeout=15)
    return parse_inventory(json.loads(raw))
