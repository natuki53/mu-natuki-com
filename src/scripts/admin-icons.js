import {
  createIcons, LayoutDashboard, Server, Boxes, DatabaseBackup, Logs,
  GitBranch, Clock3, History, Sun, Moon, ArrowUpRight, RefreshCw, HardDrive, Usb, Disc3,
} from 'lucide';

// Explicit imports keep the rest of the icon library out of the production bundle.
const icons = { LayoutDashboard, Server, Boxes, DatabaseBackup, Logs, GitBranch, Clock3, History, Sun, Moon, ArrowUpRight, RefreshCw, HardDrive, Usb, Disc3 };

export function renderAdminIcons(root = document) {
  createIcons({ icons, root, attrs: { 'stroke-width': 1.8, 'aria-hidden': 'true', focusable: 'false' } });
}
