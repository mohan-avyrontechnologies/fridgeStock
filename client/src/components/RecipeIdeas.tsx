import type { RecipeIdeas as Ideas } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api/client';
import { aiCopy, leftoverCopy, recipeCopy } from '../copy';
import { useAiStore } from '../stores/aiStore';
import { Button, Card } from './ui';

/**
 * AI recipe ideas built from the Cook First list. Shown only when AI is on.
 * The ideas read the Cook First order; nothing here changes it.
 */
export function RecipeIdeas() {
  const status = useAiStore((s) => s.status);
  const loadStatus = useAiStore((s) => s.load);
  const navigate = useNavigate();
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (!status?.enabled) return null;

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      setIdeas(await api.suggestRecipes());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
      void loadStatus();
    }
  }

  return (
    <section aria-labelledby="recipes-title" className="space-y-3">
      <div>
        <h2 id="recipes-title" className="text-lg font-semibold">
          {recipeCopy.title}
        </h2>
        <p className="text-sm text-muted">{recipeCopy.intro}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={suggest} disabled={busy}>
          {busy ? aiCopy.busy : ideas ? recipeCopy.again : recipeCopy.button}
        </Button>
        <span className="text-sm text-muted">{aiCopy.left(status.usedToday, status.dailyLimit)}</span>
      </div>
      {error && (
        <p role="alert" className="rounded-button bg-past px-3.5 py-3 text-sm text-past-ink">
          {error}
        </p>
      )}
      {ideas && ideas.recipes.length === 0 && <p className="text-sm text-muted">{recipeCopy.none}</p>}
      {ideas && ideas.recipes.length > 0 && (
        <>
          <ul className="grid gap-3 lg:grid-cols-2">
            {ideas.recipes.map((recipe) => (
              <Card as="li" key={recipe.title} className="p-4">
                <h3 className="font-semibold">{recipe.title}</h3>
                <p className="text-sm text-muted">{recipeCopy.minutes(recipe.minutes)}</p>
                <p className="mt-2 text-sm">
                  <span className="font-medium">{recipeCopy.uses}: </span>
                  {recipe.uses.map((food, i) => (
                    <span key={food.id}>
                      {i > 0 && ', '}
                      <Link to={`/food/${food.id}`} className="text-brand underline-offset-2 hover:underline">
                        {food.name}
                      </Link>
                    </span>
                  ))}
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                  {recipe.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <Button
                  variant="ghost"
                  className="-ml-4 mt-1"
                  onClick={() => navigate('/add', { state: { name: leftoverCopy.name(recipe.title), leftover: true } })}
                >
                  {leftoverCopy.save}
                </Button>
              </Card>
            ))}
          </ul>
          <p className="text-sm text-muted">{aiCopy.note}</p>
        </>
      )}
    </section>
  );
}
