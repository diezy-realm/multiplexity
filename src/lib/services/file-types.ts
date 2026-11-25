const CONFIG_EXTENSIONS = [
  '.env', '.yaml', '.yml', '.json', '.conf', '.config', '.toml', '.ini',
  '.service', '.xml', '.properties', '.cfg',
];

export function isConfigFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('.env')) return true;
  return CONFIG_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function isCodeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ['.go', '.ts', '.js', '.py', '.sh', '.sql', '.php', '.rs', '.java',
    '.c', '.cpp', '.html', '.css', '.mod', '.sum'].some(ext => lower.endsWith(ext)) || lower === 'dockerfile';
}
