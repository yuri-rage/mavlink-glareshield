import React, { lazy, Suspense, useEffect, useState } from 'react';

import { DashboardGrid } from './components/dashboard/DashboardGrid';
import { EditToolbar } from './components/editor/EditToolbar';
import { Navbar } from './components/navbar/Navbar';
import { VehicleSwitchDialog } from './components/navbar/VehiclePicker';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { useAudioAlertListener } from './lib/audioAlerts';
import { useConnectionStore } from './store/connectionStore';
import { useLayoutStore } from './store/layoutStore';
import { CustomWidgetDefinition } from './types/widget';

// Editor modals load when first opened.
const AddWidgetModal = lazy(() =>
  import('./components/editor/AddWidgetModal').then((m) => ({ default: m.AddWidgetModal }))
);
const CustomWidgetCreatorModal = lazy(() =>
  import('./components/editor/CustomWidgetCreatorModal').then((m) => ({ default: m.CustomWidgetCreatorModal }))
);
const ProfileManagerModal = lazy(() =>
  import('./components/editor/ProfileManagerModal').then((m) => ({ default: m.ProfileManagerModal }))
);

/**
 * The audio alerts listener, in a component of its own that renders nothing: it subscribes to telemetry (battery,
 * heartbeat, messages, waypoints), and as a hook of App it re-rendered the whole dashboard with each of those updates.
 */
const AudioAlerts: React.FC = () => {
  useAudioAlertListener();
  return null;
};

export const App: React.FC = () => {
  // Only the action: subscribing to the whole store would re-render the entire dashboard on every 1 s stats tick.
  const connect = useConnectionStore((s) => s.connect);
  const cockpitFill = useLayoutStore((s) => s.cockpitFill);

  const [isAddWidgetOpen, setIsAddWidgetOpen] = useState(false);
  const [isWidgetCreatorOpen, setIsWidgetCreatorOpen] = useState(false);
  const [editingCustomWidget, setEditingCustomWidget] = useState<CustomWidgetDefinition | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Attempt auto-connect to default websocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    // A Cockpit tab shown as panes: the page is exactly the window's height and doesn't scroll; the navbar (and its
    // banners, and the edit toolbar) take what they need and the panes take the rest, by flexbox alone.
    <div
      className={`${cockpitFill ? 'h-dvh overflow-hidden' : 'min-h-screen overflow-x-clip'} flex flex-col bg-zinc-950 font-sans text-zinc-100 selection:bg-sky-500/30`}
    >
      {/* Global audio alerts, active across all tabs */}
      <AudioAlerts />

      {/* Top Navbar */}
      <Navbar />

      {/* Confirms a switch to another vehicle when something is at stake */}
      <VehicleSwitchDialog />

      {/* In-app confirmations that mustn't block the page (and the vehicle heartbeat) while they're open */}
      <ConfirmDialog />

      {/* Edit Mode Toolbar (populates just below the top bar when edit mode is active) */}
      <EditToolbar
        onOpenWidgetModal={() => setIsAddWidgetOpen(true)}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
      />

      {/* Main Responsive Dashboard Area */}
      <main className="flex min-h-0 flex-1 flex-col">
        <DashboardGrid
          onEditCustomWidget={(cw) => {
            setEditingCustomWidget(cw);
            setIsWidgetCreatorOpen(true);
          }}
        />
      </main>

      {/* Modals: mounted only while open, so their code loads on first use */}
      <Suspense fallback={null}>
        {isAddWidgetOpen && (
          <AddWidgetModal
            isOpen
            onClose={() => setIsAddWidgetOpen(false)}
            onOpenWidgetCreator={() => {
              setEditingCustomWidget(null);
              setIsWidgetCreatorOpen(true);
            }}
            onEditCustomWidget={(cw) => {
              setIsAddWidgetOpen(false);
              setEditingCustomWidget(cw);
              setIsWidgetCreatorOpen(true);
            }}
          />
        )}

        {isWidgetCreatorOpen && (
          <CustomWidgetCreatorModal
            isOpen
            onClose={() => {
              setIsWidgetCreatorOpen(false);
              setEditingCustomWidget(null);
            }}
            initialWidget={editingCustomWidget}
          />
        )}

        {isProfileModalOpen && <ProfileManagerModal isOpen onClose={() => setIsProfileModalOpen(false)} />}
      </Suspense>
    </div>
  );
};

export default App;
