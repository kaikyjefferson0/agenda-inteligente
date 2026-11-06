import { Button } from '@/components/ui/button'

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Agenda Inteligente
        </h1>
        <p className="text-muted-foreground">
          Agendamento online para negócios de beleza e bem-estar.
        </p>
      </div>
      <Button disabled>Agendamento em breve</Button>
    </main>
  )
}

export default App
