/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { BookOpen, Clock, Menu, Moon, Sun } from 'lucide-react';
import { ChatProvider } from './context/ChatContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import HubLayout from './components/hub/HubLayout';
import ManualModal from './components/ManualModal';
import RoutinesModal from './components/RoutinesModal';
import { Button } from './components/ui/Button';
import { IconButton } from './components/ui/IconButton';
import { ConfirmDialogProvider } from './components/ui/ConfirmDialog';
import { useDisclosure } from './hooks/useDisclosure';
import { useIsMobile } from './hooks/useMediaQuery';

export default function App() {
  const manual = useDisclosure();
  const routinesUi = useDisclosure();
  const sidebarDrawer = useDisclosure();
  const isMobile = useIsMobile();

  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('mch:theme') === 'dark'; } catch { return false; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) { root.classList.add('dark'); localStorage.setItem('mch:theme', 'dark'); }
    else { root.classList.remove('dark'); localStorage.setItem('mch:theme', 'light'); }
  }, [isDark]);

  return (
    <ErrorBoundary>
    <ConfirmDialogProvider>
      <ChatProvider>
        <div className="h-dvh w-full bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans overflow-hidden text-zinc-900 dark:text-zinc-100 selection:bg-indigo-100 selection:text-indigo-900">
          <header className="flex-none bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              {isMobile && (
                <IconButton
                  aria-label="Abrir agentes"
                  icon={<Menu className="w-5 h-5" />}
                  onClick={sidebarDrawer.open}
                />
              )}
              <h1 className="text-base sm:text-xl font-bold flex items-center gap-2 sm:gap-3 tracking-tight text-zinc-800 dark:text-zinc-100 truncate">
                <img
                  src={`${import.meta.env.BASE_URL}logo.svg`}
                  alt=""
                  aria-hidden="true"
                  className="w-8 h-8 sm:w-9 sm:h-9 shrink-0"
                />
                <span className="truncate">
                  <span className="text-indigo-900 dark:text-indigo-400">MULT-</span>
                  <span className="text-emerald-500">CHAT</span>
                  <span className="text-indigo-900 dark:text-indigo-400">-HUB</span>
                  <span className="hidden md:inline text-zinc-400 dark:text-zinc-500 font-normal text-sm ml-2">Hub de Colaboração Multi-IA</span>
                </span>
              </h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <IconButton
                aria-label={isDark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
                icon={isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                onClick={() => setIsDark((d) => !d)}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Clock className="w-4 h-4" />}
                onClick={routinesUi.open}
                className="hidden sm:inline-flex"
              >
                Rotinas
              </Button>
              <IconButton
                aria-label="Rotinas"
                icon={<Clock className="w-5 h-5" />}
                onClick={routinesUi.open}
                className="sm:hidden"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<BookOpen className="w-4 h-4" />}
                onClick={manual.open}
                className="hidden sm:inline-flex"
              >
                Manual APIs
              </Button>
              <IconButton
                aria-label="Manual de APIs"
                icon={<BookOpen className="w-5 h-5" />}
                onClick={manual.open}
                className="sm:hidden"
              />
            </div>
          </header>

          <HubLayout sidebarOpen={sidebarDrawer.isOpen} onCloseSidebar={sidebarDrawer.close} />

          <ManualModal isOpen={manual.isOpen} onClose={manual.close} />
          <RoutinesModal isOpen={routinesUi.isOpen} onClose={routinesUi.close} />
        </div>
      </ChatProvider>
    </ConfirmDialogProvider>
    </ErrorBoundary>
  );
}
