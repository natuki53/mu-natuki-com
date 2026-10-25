import copy
import json
import unittest

from disk_inventory import collect_disks,parse_inventory,LSBLK_COLUMNS


def inventory():
    return {'blockdevices':[
        {'name':'sda','path':'/dev/sda','type':'disk','size':500000,'rota':False,'rm':False,'tran':'sata','model':'System SSD','children':[
            {'name':'sda1','path':'/dev/sda1','type':'part','size':1000,'fstype':'vfat','mountpoints':['/boot/efi'],'fssize':900,'fsused':200,'fsavail':700},
            {'name':'sda2','path':'/dev/sda2','type':'part','size':499000,'fstype':'LVM2_member','mountpoints':[None],'children':[
                {'name':'root','path':'/dev/mapper/root','type':'lvm','size':490000,'fstype':'ext4','mountpoints':['/','/bind/root','/'],'fssize':480000,'fsused':280000,'fsavail':200000},
            ]},
        ]},
        {'name':'sdb','path':'/dev/sdb','type':'disk','size':'8000000','rota':1,'rm':0,'tran':'sata','model':'Data HDD','children':[
            {'name':'sdb1','path':'/dev/sdb1','type':'part','size':'7999999','fstype':'ext4','mountpoints':['/srv/storage'],'fssize':'7900000','fsused':'100000','fsavail':'7800000'},
        ]},
        {'name':'sdc','path':'/dev/sdc','type':'disk','size':32000,'rota':False,'rm':True,'tran':'usb','children':[
            {'name':'sdc1','path':'/dev/sdc1','type':'part','size':31900,'fstype':'vfat','mountpoints':[None],'fssize':9999,'fsused':0,'fsavail':9999},
        ]},
        {'name':'loop0','path':'/dev/loop0','type':'loop','size':10000},
        {'name':'zram0','path':'/dev/zram0','type':'disk','size':10000,'rota':False},
    ]}


class InventoryTests(unittest.TestCase):
    def test_all_physical_devices_including_unmounted_usb(self):
        disks=parse_inventory(inventory())
        self.assertEqual([d['kind'] for d in disks],['ssd','hdd','usb'])
        usb=disks[2]['volumes'][0]
        self.assertFalse(usb['mounted']);self.assertIsNone(usb['usedBytes']);self.assertIsNone(usb['freeBytes'])
        self.assertTrue(disks[2]['removable'])
    def test_lvm_and_multiple_mounts_are_not_duplicate_volumes(self):
        disk=parse_inventory(inventory())[0]
        self.assertEqual(len(disk['volumes']),3)
        self.assertTrue(disk['volumes'][1]['container'])
        root=disk['volumes'][2]
        self.assertEqual(root['mountpoints'],['/','/bind/root'])
        self.assertEqual(root['totalBytes'],480000)
        self.assertEqual(root['freeBytes'],200000)
    def test_shared_raid_or_lvm_is_marked_without_aggregation(self):
        raw=inventory()
        shared=copy.deepcopy(raw['blockdevices'][0]['children'][1]['children'][0])
        raw['blockdevices'][1]['children'].append(shared)
        disks=parse_inventory(raw)
        self.assertTrue(disks[0]['volumes'][-1]['shared'])
        self.assertTrue(disks[1]['volumes'][-1]['shared'])
        self.assertNotIn('usedBytes',disks[0])
    def test_nvme_whole_disk_filesystem_and_unknown_capacity(self):
        raw={'blockdevices':[{'path':'/dev/nvme0n1','type':'disk','size':1000,'rota':False,'tran':'nvme','fstype':'btrfs','mountpoints':['/mnt/data'],'fssize':None,'fsused':None,'fsavail':None}]}
        disk=parse_inventory(raw)[0]
        self.assertEqual(disk['kind'],'nvme');self.assertTrue(disk['volumes'][0]['mounted'])
        self.assertIsNone(disk['volumes'][0]['usedBytes'])
    def test_duplicate_top_level_disks_are_merged(self):
        raw=inventory();raw['blockdevices'].append(copy.deepcopy(raw['blockdevices'][0]))
        self.assertEqual(len(parse_inventory(raw)),3)
        self.assertEqual(len(parse_inventory(raw)[0]['volumes']),3)
    def test_only_fixed_read_command_is_used(self):
        calls=[]
        def run(args,timeout):calls.append((args,timeout));return json.dumps(inventory())
        self.assertEqual(len(collect_disks(run)),3)
        self.assertEqual(calls,[(['lsblk','--json','--bytes','--tree','--output',LSBLK_COLUMNS],15)])
    def test_invalid_or_excessive_inventory_is_rejected(self):
        for raw in [{}, {'blockdevices':[{'type':'disk','path':'/etc/passwd'}]},
                    {'blockdevices':[{'type':'disk','path':f'/dev/test{i}'} for i in range(65)]}]:
            with self.assertRaises(ValueError):parse_inventory(raw)


if __name__=='__main__':unittest.main()
