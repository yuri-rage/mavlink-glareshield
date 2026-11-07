import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Navbar } from './components/navbar/Navbar';
import { EditToolbar } from './components/editor/EditToolbar';
import { DashboardGrid } from './components/dashboard/DashboardGrid';
import { useConnectionStore } from './store/connectionStore';
import { CustomWidgetDefinition } from './types/widget';
import { useAudioAlertListener } from './lib/audioAlerts';

// Editor modals load when first opened.
const AddWidgetModal = lazy(() => import('./components/editor/AddWidgetModal').then((m) => ({ default: m.AddWidgetModal })));
const CustomWidgetCreatorModal = lazy(() =>
  import('./components/editor/CustomWidgetCreatorModal').then((m) => ({ default: m.CustomWidgetCreatorModal }))
);
const ProfileManagerModal = lazy(() => import('./components/editor/ProfileManagerModal').then((m) => ({ default: m.ProfileManagerModal })));

export const App: React.FC = () => {
  // Only the action: subscribing to the whole store would re-render the entire dashboard on every 1 s stats tick.
  const connect = useConnectionStore((s) => s.connect);

  // Global audio alerts listener active across all tabs
  useAudioAlertListener();

  const [isAddWidgetOpen, setIsAddWidgetOpen] = useState(false);
  const [isWidgetCreatorOpen, setIsWidgetCreatorOpen] = useState(false);
  const [editingCustomWidget, setEditingCustomWidget] = useState<CustomWidgetDefinition | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Attempt auto-connect to default websocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-sky-500/30 overflow-x-clip">
      {/* Top Navbar */}
      <Navbar />

      {/* Edit Mode Toolbar (populates just below the top bar when edit mode is active) */}
      <EditToolbar
        onOpenWidgetModal={() => setIsAddWidgetOpen(true)}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
      />

      {/* Main Responsive Dashboard Area */}
      <main className="flex-1 flex flex-col">
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
