import { t, useLanguage } from './i18n';
import { useState } from 'react';
import { Eraser, Settings, Trash2 } from 'lucide-react';
import type { NodeData } from './types';

export default function NodeSettings({ id, data, editableTitle = true }: {
  id: string;
  data: NodeData;
  editableTitle?: boolean;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
    <button className="icon-button nodrag nopan" aria-label={t('Node leeren')} title={t('Leeren')}
      onClick={() => data.onClear(id)}><Eraser size={14} /></button>
    <div className="node-settings-control nodrag nopan">
      <button className="icon-button" aria-label={t('Node-Einstellungen')} title={t('Einstellungen')}
        aria-expanded={open} aria-controls={`node-settings-${id}`} onClick={() => setOpen(!open)}>
        <Settings size={14} />
      </button>
      {open && (
        <div className="node-settings-popover" id={`node-settings-${id}`}>
          {editableTitle && (
            <label className="node-settings-title">
              {t('Name bearbeiten')}
              <input aria-label={t('Node-Titel')} value={data.title}
                onChange={(event) => data.onChange(id, { title: event.target.value })} />
            </label>
          )}
          <button className="text-button" onClick={() => { data.onDelete(id); setOpen(false); }}>
            <Trash2 size={13} /> {t('Node löschen')}
          </button>
        </div>
      )}
    </div>
    </>
  );
}
