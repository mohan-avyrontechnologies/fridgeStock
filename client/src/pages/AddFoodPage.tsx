import { useNavigate } from 'react-router';
import { PageBody, PageHeader } from '../components/AppShell';
import { FoodForm } from '../components/FoodForm';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';

export function AddFoodPage() {
  const add = useFoodStore((s) => s.add);
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="Add food" back="/" />
      <PageBody narrow>
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
      </PageBody>
    </>
  );
}
