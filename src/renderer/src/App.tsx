import { ScanPreview } from './pages/ScanPreview'

export function App(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      {/* Draggable strip under the native title-bar buttons (the window is frameless). */}
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />
      <main className="min-h-0 flex-1">
        <ScanPreview />
      </main>
    </div>
  )
}
