import {
  AppWindow, Download, FolderLock, Folder, GlobeLock, KeyRound, Laptop, Mail, Mouse, Package, Printer, ShieldCheck,
  Smartphone, UserPlus, Wifi, Server, Headphones, Monitor, type LucideProps,
} from "lucide-react";

const MAP = {
  "app-window": AppWindow, download: Download, "folder-lock": FolderLock, folder: Folder, "globe-lock": GlobeLock,
  "key-round": KeyRound, laptop: Laptop, mail: Mail, mouse: Mouse, package: Package, printer: Printer,
  "shield-check": ShieldCheck, smartphone: Smartphone, "user-plus": UserPlus, wifi: Wifi, server: Server,
  headphones: Headphones, monitor: Monitor,
} as const;

export const ICON_NAMES = Object.keys(MAP);

export function DynIcon({ name, ...props }: { name: string } & LucideProps) {
  const C = MAP[name as keyof typeof MAP] ?? Package;
  return <C {...props} />;
}
