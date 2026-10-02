import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet } from '../components/ui';

/** The bottom sheet is a real dialog: named, focus moves in and stays in, and Escape or the backdrop closes it. */

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <BottomSheet
          title="Pick one"
          description="Choose carefully"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button>First</button>
          <input aria-label="Amount" />
          <button>Last</button>
        </BottomSheet>
      )}
    </>
  );
}

describe('BottomSheet', () => {
  it('is a modal dialog named by its title, with its description', async () => {
    const reader = userEvent.setup();
    render(<Harness />);
    await reader.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Pick one' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Choose carefully')).toBeInTheDocument();
  });

  it('moves focus to the first field when it opens', async () => {
    const reader = userEvent.setup();
    render(<Harness />);
    await reader.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByLabelText('Amount')).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the sheet', async () => {
    const reader = userEvent.setup();
    render(<Harness />);
    await reader.click(screen.getByRole('button', { name: 'Open' }));
    await reader.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await reader.tab(); // past the last: back to the first
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await reader.tab({ shift: true }); // before the first: round to the last
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('Escape closes it, and focus goes back to the button that opened it', async () => {
    const reader = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const open = screen.getByRole('button', { name: 'Open' });
    await reader.click(open);
    await reader.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('a tap on the backdrop closes it', async () => {
    const reader = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await reader.click(screen.getByRole('button', { name: 'Open' }));
    await reader.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
