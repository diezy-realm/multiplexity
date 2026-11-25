import {
  AppWindow,
  Clock,
  Copy,
  Download,
  FileText,
  Layers,
  LogOut,
  Pencil,
  Trash2,
} from 'lucide-react';

export default function ActionIcon({
  name,
}: {
  name: 'copy' | 'download' | 'clock' | 'edit' | 'trash' | 'summary' | 'window' | 'logo' | 'logout';
}) {
  const props = { 'aria-hidden': true as const, size: 18, strokeWidth: 1.7 };
  switch (name) {
    case 'copy':
      return <Copy {...props} />;
    case 'download':
      return <Download {...props} />;
    case 'clock':
      return <Clock {...props} />;
    case 'edit':
      return <Pencil {...props} />;
    case 'trash':
      return <Trash2 {...props} />;
    case 'summary':
      return <FileText {...props} />;
    case 'window':
      return <AppWindow {...props} />;
    case 'logo':
      return <Layers {...props} />;
    case 'logout':
      return <LogOut {...props} />;
  }
}
