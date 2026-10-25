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

// Short badge shown next to a file in the file picker (none for .scad files).
export function fileKindBadge(path: string): string | null {
  switch (extensionOf(path)) {
    case 'dxf': case 'svg': return '2D';
    case 'stl': case 'off': case '3mf': case 'amf': case 'obj': case 'nef3': return '3D';
    case 'png': case 'dat': return 'height map';
    case 'dwg': case 'pdf': case 'html': return 'not importable';
    default: return null;
  }
}

export interface DxfInfo {
  layers: string[];
  units?: {name: string, scale: number};  // scale converts the drawing's units to OpenSCAD's mm
  binary: boolean;
}

const DXF_UNITS: Record<number, {name: string, scale: number}> = {
  1: {name: 'inches', scale: 25.4},
  2: {name: 'feet', scale: 304.8},
  4: {name: 'millimeters', scale: 1},
  5: {name: 'centimeters', scale: 10},
  6: {name: 'meters', scale: 1000},
};

// Reads layer names and drawing units out of an ASCII DXF (best effort).
export function analyzeDxf(bytes: ArrayBuffer): DxfInfo {
  const text = new TextDecoder('windows-1252').decode(bytes);
  if (text.startsWith('AutoCAD Binary DXF')) return {layers: [], binary: true};
  const lines = text.split(/\r?\n/);
  const layers = new Set<string>();
  let units: DxfInfo['units'];
  let afterLayerRecord = false;
  let wantUnits = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (code === 0) {
      afterLayerRecord = value === 'LAYER';
      wantUnits = false;
    } else if (code === 2 && afterLayerRecord) {
      layers.add(value);
      afterLayerRecord = false;
    } else if (code === 8 && value) {
      layers.add(value);
    } else if (code === 9) {
      wantUnits = value === '$INSUNITS';
    } else if (code === 70 && wantUnits) {
      units = DXF_UNITS[parseInt(value, 10)];
      wantUnits = false;
    }
  }
  return {layers: [...layers], units, binary: false};
}

// Starter code for a file the visitor just uploaded, or null when OpenSCAD can't import it.
export function buildImportSnippet(path: string, dxf?: DxfInfo): string | null {
  const ext = extensionOf(path);
  const quoted = JSON.stringify(path);
  switch (ext) {
    case 'dxf': case 'svg': {
      const layers = (dxf?.layers ?? []).filter(l => l !== '0' || dxf!.layers.length === 1);
      const scale = dxf?.units?.scale ?? 1;
      const notes: string[] = [];
      if (layers.length > 0) notes.push(`layers: ${layers.map(l => JSON.stringify(l)).join(', ')}`);
      if (dxf?.units && scale !== 1) notes.push(`drawn in ${dxf.units.name}, scaled x${scale} to mm`);
      const lines = [`// ${path.slice(1)}${notes.length ? ' (' + notes.join('; ') + ')' : ''}`, 'linear_extrude(height = 3)'];
      if (scale !== 1) {
        lines.push(`  scale(${scale})`, `    import(${quoted});`);
      } else {
        lines.push(`  import(${quoted});`);
      }
      if (layers.length > 1) lines.push(`// one layer only: import(${quoted}, layer = ${JSON.stringify(layers[0])});`);
      return lines.join('\n') + '\n';
    }
    case 'stl': case 'off': case '3mf': case 'amf': case 'obj': case 'nef3':
      return `import(${quoted});\n`;
    case 'png': case 'dat':
      return `surface(file = ${quoted}, center = true);\n`;
    default:
      return null;
  }
}
