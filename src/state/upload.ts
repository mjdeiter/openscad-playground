// Helpers for the editor menu's "Upload file(s)".

import { Source } from './app-state.ts';
import { readFileAsDataURL } from '../utils.ts';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Kept as editable text. Everything else is stored byte-for-byte (as a data URL), so
// DXF code pages, binary STL/3MF, images etc. are never re-encoded.
const TEXT_EXTENSIONS = new Set(['scad', 'json', 'txt', 'md', 'csv']);

export function extensionOf(path: string): string {
  const m = /\.([^./]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f"*:<>?|]/g, '_').replace(/^\.+/, '_').trim();
  return cleaned || 'upload';
}

export async function fileToSource(file: File): Promise<Source> {
  const path = '/' + sanitizeFileName(file.name);
  if (isTextPath(path)) {
    const text = (await file.text()).replace(/\r\n/g, '\n');
    return {path, content: text === '' ? '\n' : text};
  }
  return {path, url: await readFileAsDataURL(file)};
}

// What a visitor can do with the file inside OpenSCAD.
export function describeUpload(path: string): string {
  switch (extensionOf(path)) {
    case 'scad': return 'OpenSCAD source (use <> / include)';
    case 'dxf': case 'svg': return `import("${path}") — 2D drawing; wrap in linear_extrude()`;
    case 'stl': case 'off': case '3mf': case 'amf': case 'obj': case 'nef3': return `import("${path}") — 3D model`;
    case 'png': case 'dat': return `surface(file="${path}")`;
    case 'dwg': return 'saved, but OpenSCAD cannot read DWG — export DXF from the CAD site';
    case 'json': case 'txt': case 'md': case 'csv': return 'saved as text';
    default: return 'saved, but OpenSCAD cannot import this file type';
  }
}
