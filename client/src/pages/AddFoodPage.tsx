import { useNavigate } from 'react-router';
import { PageHeader } from '../components/AppShell';
import { FoodForm } from '../components/FoodForm';
import { EstimateNote } from '../components/Urgency';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';

export function AddFoodPage() {
  const add = useFoodStore((s) => s.add);
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="Add food" back="/" />
      <main className="space-y-5 px-4 pt-4">
        <FoodForm
          submitLabel="Save"
          allowAddAnother
          autoFocus
          onSubmit={async (input, addAnother) => {
            await add(input);
            toast(`Added ${input.name}`);
            if (!addAnother) navigate('/');
          }}
        />
        <EstimateNote long />
      </main>
    </>
  );
}
