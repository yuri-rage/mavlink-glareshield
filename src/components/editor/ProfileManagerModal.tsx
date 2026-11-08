import { profileVehicleControls } from '../../lib/vehicleControls';
import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { DashboardProfile } from '../../types/widget';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Download, Upload, RotateCcw, Copy, Check, AlertTriangle, Layers } from 'lucide-react';
import { downloadFile } from '../../lib/download';

interface ProfileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileManagerModal: React.FC<ProfileManagerModalProps> = ({ isOpen, onClose }) => {
  const { profile, exportProfileJson, importProfileJson, resetToDefaults } = useDashboardStore();
  const [jsonText, setJsonText] = useState('');
  const [copied, setCopied] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState<DashboardProfile | null>(null);

  const handleDownload = () => {
    downloadFile(`mavlink-glareshield-profile-${new Date().toISOString().slice(0, 10)}.json`, exportProfileJson(), 'application/json');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(exportProfileJson());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          const parsed = JSON.parse(content) as DashboardProfile;
          if (parsed && Array.isArray(parsed.tabs)) {
            setPendingProfile(parsed);
            setImportStatus(null);
          } else {
            setImportStatus('Invalid profile format: missing tabs array.');
          }
        } catch {
          setImportStatus('Invalid JSON syntax.');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTextImport = () => {
    if (!jsonText.trim()) return;
    try {
      const parsed = JSON.parse(jsonText.trim()) as DashboardProfile;
      if (parsed && Array.isArray(parsed.tabs)) {
        setPendingProfile(parsed);
        setImportStatus(null);
      } else {
        setImportStatus('Invalid JSON profile format.');
      }
    } catch {
      setImportStatus('Invalid JSON syntax.');
    }
  };

  const confirmApplyProfile = () => {
    if (!pendingProfile) return;
    const success = importProfileJson(JSON.stringify(pendingProfile));
    if (success) {
      setImportStatus('Profile imported successfully!');
      setTimeout(() => {
        setImportStatus(null);
        setPendingProfile(null);
        onClose();
      }, 1000);
    } else {
      setImportStatus('Failed to apply profile.');
    }
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset your layout and widgets to default?')) {
      resetToDefaults();
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Layout Profile & Backup Manager"
      description="Export your customized tabs, widgets, and layout configuration or import an existing profile."
    >
      <div className="space-y-4">
        {/* Export / Download Section */}
        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Export Active Profile
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {profile.tabs.length} tabs • {profile.customWidgets.length} custom widgets
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleDownload}
              className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold gap-1.5 h-8 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              Download .json Profile
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-3 text-xs border-zinc-700 gap-1"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        {/* Import Preview Confirmation */}
        {pendingProfile && (
          <div className="p-4 bg-zinc-900 border border-sky-500/50 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
              <Layers className="h-4 w-4" />
              <span>Import Profile Preview: {pendingProfile.name || 'Untitled Profile'}</span>
            </div>

            <div className="text-xs text-zinc-300 space-y-1.5 font-mono">
              <div><b className="text-zinc-400">Version:</b> {pendingProfile.version || '1.0.0'}</div>
              <div>
                <b className="text-zinc-400">Tabs ({pendingProfile.tabs.length}):</b>{' '}
                {pendingProfile.tabs.map((t) => t.title).join(', ')}
              </div>
              <div>
                <b className="text-zinc-400">Custom Widgets:</b> {pendingProfile.customWidgets?.length || 0}
              </div>

              {(() => {
                const found = profileVehicleControls(pendingProfile);
                const custom = found.filter((c) => !c.builtin);
                const builtin = found.filter((c) => c.builtin);
                return (
                  <>
                    {custom.length > 0 && (
                      <div className="p-2.5 bg-amber-950/40 border border-amber-600/40 rounded mt-2 space-y-1 text-amber-200">
                        <div className="font-bold flex items-center gap-1.5 text-amber-300">
                          <AlertTriangle className="h-4 w-4" />
                          Custom widgets that act on the vehicle:
                        </div>
                        <ul className="list-disc list-inside text-[11px] text-zinc-300 space-y-0.5">
                          {custom.map((c, i) => (
                            <li key={`${c.name}-${i}`}>
                              <b>{c.name}</b>: {c.controls.join('; ')}
                            </li>
                          ))}
                        </ul>
                        <div className="text-[11px] text-amber-400 mt-1">
                          * Confirmation is enforced on every imported command and parameter write.
                        </div>
                      </div>
                    )}
                    {builtin.length > 0 && (
                      <div className="text-[11px] text-zinc-400 mt-2">
                        <b className="text-zinc-300">Built-in widgets with vehicle controls</b> (their own confirmations, as
                        when you place them yourself): {builtin.map((c) => c.name).join(', ')}.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="default"
                size="sm"
                onClick={confirmApplyProfile}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                Confirm & Apply Profile
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingProfile(null)}
                className="text-zinc-400"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Import Section */}
        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 block">
            Import Profile (.json)
          </span>

          <label className="block">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="w-full gap-1.5 h-9 border-dashed border-zinc-700 text-zinc-300 pointer-events-none"
            >
              <Upload className="h-4 w-4 text-emerald-400" />
              Choose JSON File to Import
            </Button>
          </label>

          <textarea
            placeholder="Or paste JSON profile text here..."
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="w-full h-20 rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />

          {jsonText.trim() && (
            <Button
              size="sm"
              variant="default"
              onClick={handleTextImport}
              className="w-full h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Apply Pasted Profile
            </Button>
          )}

          {importStatus && (
            <p className="text-xs text-center font-bold text-sky-400 animate-pulse">
              {importStatus}
            </p>
          )}
        </div>

        {/* Reset to Factory Defaults */}
        <div className="pt-1 flex items-center justify-between border-t border-zinc-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-red-400 hover:text-red-300 hover:bg-red-950/30 gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Default Layout
          </Button>

          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};
