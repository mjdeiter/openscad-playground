// Portions of this file are Copyright 2021 Google LLC, and licensed under GPL2+. See COPYING.

import React, { CSSProperties, useContext, useRef, useState } from 'react';
import Editor, { loader, Monaco } from '@monaco-editor/react';
import openscadEditorOptions from '../language/openscad-editor-options.ts';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { InputTextarea } from 'primereact/inputtextarea';
import { Button } from 'primereact/button';
import { MenuItem } from 'primereact/menuitem';
import { Menu } from 'primereact/menu';
import { buildUrlForStateParams } from '../state/fragment-state.ts';
import { getBlankProjectState, defaultSourcePath } from '../state/initial-state.ts';
import { ModelContext, FSContext } from './contexts.ts';
import FilePicker, {  } from './FilePicker.tsx';
import { Toast } from 'primereact/toast';
import { Source } from '../state/app-state.ts';
import { describeUpload, fileToSource, MAX_UPLOAD_BYTES } from '../state/upload.ts';
import { clearSavedState, persistenceMode } from '../state/local-state.ts';
import { formatBytes } from '../utils.ts';

// const isMonacoSupported = false;
const isMonacoSupported = (() => {
  const ua = window.navigator.userAgent;
  const iosWk = ua.match(/iPad|iPhone/i) && ua.match(/WebKit/i);
  const android = ua.match(/Android/i);
  return !(iosWk || android);
})();

let monacoInstance: Monaco | null = null;
if (isMonacoSupported) {
  loader.init().then(mi => monacoInstance = mi);
}

export default function EditorPanel({className, style}: {className?: string, style?: CSSProperties}) {

  const model = useContext(ModelContext);
  if (!model) throw new Error('No model');

  const menu = useRef<Menu>(null);
  const toast = useRef<Toast>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    try {
      const existing = new Set(model.state.params.sources.map(s => s.path));
      const accepted: Source[] = [];
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.current?.show({severity: 'error', summary: `${file.name} is too large`, detail: `Limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`, life: 8000});
          continue;
        }
        const source = await fileToSource(file);
        if (existing.has(source.path) && !window.confirm(`Replace the existing ${source.path}?`)) continue;
        accepted.push(source);
      }
      if (accepted.length === 0) return;
      model.addSources(accepted);
      toast.current?.show({
        severity: 'success',
        summary: accepted.length === 1 ? `Added ${accepted[0].path}` : `Added ${accepted.length} files`,
        detail: <span style={{whiteSpace: 'pre-line'}}>{accepted.map(s => `${s.path}: ${describeUpload(s.path)}`).join('\n')}</span>,
        life: 12000,
      });
      if (persistenceMode === 'browser' && navigator.storage?.estimate) {
        const {usage, quota} = await navigator.storage.estimate();
        if (usage != null && quota != null && usage > quota * 0.8) {
          toast.current?.show({severity: 'warn', summary: 'Browser storage is nearly full', detail: 'Remove files you no longer need, or use "Clear my saved data".', life: 12000});
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
      toast.current?.show({severity: 'error', summary: 'Upload failed', detail: `${err}`, life: 8000});
    }
  };

  const shareProject = async () => {
    try {
      const url = await buildUrlForStateParams(model.state);
      await navigator.clipboard.writeText(url);
      toast.current?.show({
        severity: 'success',
        summary: 'Link copied',
        detail: url.length > 100_000
          ? `The link is ${formatBytes(url.length)} long because it embeds your uploaded files.`
          : 'Anyone with the link gets a copy of this project.',
        life: 6000,
      });
    } catch (err) {
      console.error('Share failed:', err);
      toast.current?.show({severity: 'error', summary: 'Could not copy the link', detail: `${err}`, life: 8000});
    }
  };

  const openInNewTab = async (state: Parameters<typeof buildUrlForStateParams>[0]) => {
    // Open synchronously (keeps popup blockers happy), then point it at the link once it's built.
    const w = window.open('about:blank', '_blank');
    const url = await buildUrlForStateParams(state);
    if (w) w.location.href = url; else window.location.href = url;
  };

  const state = model.state;

  const [editor, setEditor] = useState(null as monaco.editor.IStandaloneCodeEditor | null)

  if (editor) {
    const checkerRun = state.lastCheckerRun;
    const editorModel = editor.getModel();
    if (editorModel) {
      if (checkerRun && monacoInstance) {
        monacoInstance.editor.setModelMarkers(editorModel, 'openscad', checkerRun.markers);
      }
    }
  }

  const onMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editor.addAction({
      id: "openscad-render",
      label: "Render OpenSCAD",
      run: () => model.render({isPreview: false, now: true})
    });
    editor.addAction({
      id: "openscad-preview",
      label: "Preview OpenSCAD",
      run: () => model.render({isPreview: true, now: true})
    });
    editor.addAction({
      id: "openscad-save-do-nothing",
      label: "Save (disabled)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {}
    });
    editor.addAction({
      id: "openscad-save-project",
      label: "Save OpenSCAD project",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
      run: () => model.saveProject()
    });
    setEditor(editor)
  }

  return (
    <div className={`editor-panel ${className ?? ''}`} style={{
      // maxWidth: '5 0vw',
      display: 'flex',
      flexDirection: 'column',
      // position: 'relative',
      // width: '100%', height: '100%',
      ...(style ?? {})
    }}>
      <div className='flex flex-row gap-2' style={{
        margin: '5px',
      }}>
          
        <Menu model={[
          {
            label: "New project",
            icon: 'pi pi-plus-circle',
            command: () => openInNewTab(getBlankProjectState()),
            target: '_blank',
          },
          {
            // TODO: share text, title and rendering image
            // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
            label: 'Share project',
            icon: 'pi pi-share-alt',
            command: shareProject,
          },
          {
            separator: true
          },  
          {
            // TODO: popup to ask for file name
            label: "New file",
            icon: 'pi pi-plus',
            disabled: true,
          },
          {
            label: "Copy to new file",
            icon: 'pi pi-clone',
            disabled: true,
          },
          {
            label: "Upload file(s)",
            icon: 'pi pi-upload',
            command: () => fileInput.current?.click(),
          },
          {
            label: 'Download sources',
            icon: 'pi pi-download',
            command: () => model.saveProject(),
          },
          {
            separator: true
          },
          ...(persistenceMode === 'browser' ? [{
            label: 'Clear my saved data',
            icon: 'pi pi-trash',
            command: async () => {
              if (window.confirm('Delete everything saved in this browser (your files and settings) and start over?')) {
                await clearSavedState();
                window.location.reload();
              }
            },
          }, {
            separator: true
          }] : []),
          {
            label: 'Select All',
            icon: 'pi pi-info-circle',
            command: () => editor?.trigger(state.params.activePath, 'editor.action.selectAll', null),
          },
          {
            separator: true
          },
          {
            label: 'Find',
            icon: 'pi pi-search',
            command: () => editor?.trigger(state.params.activePath, 'actions.find', null),
          },
        ] as MenuItem[]} popup ref={menu} />
        <input ref={fileInput} type="file" multiple style={{display: 'none'}} onChange={onFilesChosen} />
        <Toast ref={toast} position="top-right" />
        <Button title="Editor menu" rounded text icon="pi pi-ellipsis-h" onClick={(e) => menu.current && menu.current.toggle(e)} />
        
        <FilePicker 
            style={{
              flex: 1,
            }}/>

        {state.params.activePath !== defaultSourcePath && 
          <Button icon="pi pi-chevron-left" 
          text
          onClick={() => model.openFile(defaultSourcePath)} 
          title={`Go back to ${defaultSourcePath}`}/>}

      </div>

      
      <div style={{
        position: 'relative',
        flex: 1
      }}>
        {isMonacoSupported && (
          <Editor
            className="openscad-editor absolute-fill"
            defaultLanguage="openscad"
            path={state.params.activePath}
            value={model.source}
            onChange={s => model.source = s ?? ''}
            onMount={onMount} // TODO: This looks a bit silly, does it trigger a re-render??
            options={{
              ...openscadEditorOptions,
              fontSize: 16,
              lineNumbers: state.view.lineNumbers ? 'on' : 'off',
            }}
          />
        )}
        {!isMonacoSupported && (
          <InputTextarea 
            className="openscad-editor absolute-fill"
            value={model.source}
            onChange={s => model.source = s.target.value ?? ''}  
          />
        )}
      </div>

      <div style={{
        display: state.view.logs ? undefined : 'none',
        overflowY: 'scroll',
        height: 'calc(min(200px, 30vh))',
      }}>
        {(state.currentRunLogs ?? []).map(([type, text], i) => (
          <pre key={i}>{text}</pre>
        ))}
      </div>
    
    </div>
  )
}
