import React, { useState, useEffect } from 'react';
import { Navbar } from './components/navbar/Navbar';
import { EditToolbar } from './components/editor/EditToolbar';
import { DashboardGrid } from './components/dashboard/DashboardGrid';
import { AddWidgetModal } from './components/editor/AddWidgetModal';
import { CustomWidgetCreatorModal } from './components/editor/CustomWidgetCreatorModal';
import { ProfileManagerModal } from './components/editor/ProfileManagerModal';
import { useConnectionStore } from './store/connectionStore';

export const App: React.FC = () => {
  const { connect } = useConnectionStore();

  const [isAddWidgetOpen, setIsAddWidgetOpen] = useState(false);
  const [isWidgetCreatorOpen, setIsWidgetCreatorOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Attempt auto-connect to default websocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-sky-500/30">
      {/* Top Navbar */}
      <Navbar />

      {/* Edit Mode Toolbar (populates just below the top bar when edit mode is active) */}
      <EditToolbar
        onOpenWidgetModal={() => setIsAddWidgetOpen(true)}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
      />

      {/* Main Responsive Dashboard Area */}
      <main className="flex-1 flex flex-col">
        <DashboardGrid />
      </main>

      {/* Modals */}
      <AddWidgetModal
        isOpen={isAddWidgetOpen}
        onClose={() => setIsAddWidgetOpen(false)}
        onOpenWidgetCreator={() => setIsWidgetCreatorOpen(true)}
      />

      <CustomWidgetCreatorModal
        isOpen={isWidgetCreatorOpen}
        onClose={() => setIsWidgetCreatorOpen(false)}
      />

      <ProfileManagerModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </div>
  );
};

export default App;
