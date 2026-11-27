import React, { useState } from 'react';

import { AlertTriangle, Check, Copy, Download, Layers, RotateCcw, Upload } from 'lucide-react';

import { downloadFile } from '../../lib/download';
import { profileVehicleControls } from '../../lib/vehicleControls';
import { askConfirm } from '../../store/confirmStore';
import { parseProfileImport, useDashboardStore } from '../../store/dashboardStore';
import { DashboardProfile } from '../../types/widget';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';

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
    downloadFile(
      `mavlink-glareshield-profile-${new Date().toISOString().slice(0, 10)}.json`,
      exportProfileJson(),
      'application/json'
    );
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
          JSON.parse(content); // syntax first, for its own message
          const parsed = parseProfileImport(content);
          if (parsed) {
            setPendingProfile(parsed);
            setImportStatus(null);
          } else {
            setImportStatus('Invalid profile format: no tabs.');
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
      JSON.parse(jsonText.trim()); // syntax first, for its own message
      const parsed = parseProfileImport(jsonText.trim());
      if (parsed) {
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

  const handleReset = async () => {
    if (
      await askConfirm({
        title: 'Reset the dashboard?',
        message: [
          'Your tabs, widgets and layouts go back to the defaults. Download the profile first to keep a copy.',
          'Settings (link, units, alerts, traffic) are kept: Settings › Data › Restore defaults resets those too.',
        ],
        confirmLabel: 'Reset the dashboard',
        danger: true,
      })
    ) {
      resetToDefaults();
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Profiles & Backup"
      description="Save this dashboard (its tabs, widgets and layouts) to a file, or load one."
    >
      <div className="space-y-4">
        {/* Export / Download Section */}
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Export Active Profile</span>
            <span className="font-mono text-[10px] text-zinc-500">
              {profile.tabs.length} tabs • {profile.customWidgets.length} custom widgets
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleDownload}
              className="h-8 flex-1 gap-1.5 bg-sky-500 text-xs font-bold text-white hover:bg-sky-600"
            >
              <Download className="h-3.5 w-3.5" />
              Download .json Profile
            </Button>

            <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 gap-1 border-zinc-700 px-3 text-xs">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        {/* Import Preview Confirmation */}
        {pendingProfile && (
          <div className="space-y-3 rounded-xl border border-sky-500/50 bg-zinc-900 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-sky-400">
              <Layers className="h-4 w-4" />
              <span>Import Profile Preview: {pendingProfile.name || 'Untitled Profile'}</span>
            </div>

            <div className="space-y-1.5 font-mono text-xs text-zinc-300">
              <div>
                <b className="text-zinc-400">Version:</b> {pendingProfile.version || '1.0.0'}
              </div>
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
                      <div className="mt-2 space-y-1 rounded border border-amber-600/40 bg-amber-950/40 p-2.5 text-amber-200">
                        <div className="flex items-center gap-1.5 font-bold text-amber-300">
                          <AlertTriangle className="h-4 w-4" />
                          Custom widgets that act on the vehicle:
                        </div>
                        <ul className="list-inside list-disc space-y-0.5 text-[11px] text-zinc-300">
                          {custom.map((c, i) => (
                            <li key={`${c.name}-${i}`}>
                              <b>{c.name}</b>: {c.controls.join('; ')}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-1 text-[11px] text-amber-400">
                          * Confirmation is enforced on every imported command and parameter write.
                        </div>
                      </div>
                    )}
                    {builtin.length > 0 && (
                      <div className="mt-2 text-[11px] text-zinc-400">
                        <b className="text-zinc-300">Built-in widgets with vehicle controls</b> (their own
                        confirmations, as when you place them yourself): {builtin.map((c) => c.name).join(', ')}.
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
                className="flex-1 bg-emerald-600 font-bold text-white hover:bg-emerald-700"
              >
                Confirm & Apply Profile
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPendingProfile(null)} className="text-zinc-400">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Import Section */}
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <span className="block text-xs font-bold uppercase tracking-wider text-zinc-300">Import Profile (.json)</span>

          <label className="block">
            <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="pointer-events-none h-9 w-full gap-1.5 border-dashed border-zinc-700 text-zinc-300"
            >
              <Upload className="h-4 w-4 text-emerald-400" />
              Choose JSON File to Import
            </Button>
          </label>

          <textarea
            placeholder="Or paste JSON profile text here..."
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="h-20 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />

          {jsonText.trim() && (
            <Button
              size="sm"
              variant="default"
              onClick={handleTextImport}
              className="h-8 w-full bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
            >
              Apply Pasted Profile
            </Button>
          )}

          {importStatus && <p className="animate-pulse text-center text-xs font-bold text-sky-400">{importStatus}</p>}
        </div>

        {/* Reset to Factory Defaults */}
        <div className="flex items-center justify-between border-t border-zinc-800 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="gap-1.5 text-xs text-red-400 hover:bg-red-950/30 hover:text-red-300"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset the dashboard…
          </Button>

          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};
