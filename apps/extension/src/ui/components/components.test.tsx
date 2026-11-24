import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Tag } from './Tag';
import { Field } from './Field';
import { Dabs } from './Dabs';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import { Dialog } from './Dialog';
import { ErrorBoundary } from './ErrorBoundary';
import { installChromeFake } from '../../../test/chromeFake';

test('Button primary has primary class', () => {
  render(<Button variant="primary">Save tab</Button>);
  expect(screen.getByRole('button', { name: 'Save tab' })).toHaveClass('im-btn', 'im-btn-primary');
});
test('Button quiet has no modifier class', () => {
  render(<Button>Cancel</Button>);
  const el = screen.getByRole('button', { name: 'Cancel' });
  expect(el).toHaveClass('im-btn');
  expect(el.className).not.toMatch(/im-btn-/);
});
test('Field links label to input', () => {
  render(<Field label="Search" />);
  expect(screen.getByLabelText('Search')).toBeInTheDocument();
});
test('Field hideLabel keeps accessible name', () => {
  render(<Field label="Search" hideLabel />);
  expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
});
test('Field shows error and hint', () => {
  render(<Field label="Name" error="Enter a name" />);
  expect(screen.getByText('Enter a name')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name');
});
test('IconButton has aria-label', () => {
  render(<IconButton label="Switch theme" icon="moon" onClick={() => {}} />);
  expect(screen.getByRole('button', { name: 'Switch theme' })).toBeInTheDocument();
});
test('Tag ochre uses ochre class', () => {
  render(<Tag tone="ochre">Soon</Tag>);
  expect(screen.getByText('Soon')).toHaveClass('im-tag', 'im-tag-ochre');
});
test('Dabs is hidden from assistive tech', () => {
  const { container } = render(<Dabs />);
  expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(container.querySelectorAll('.im-dab').length).toBeGreaterThan(0);
});

describe('Menu', () => {
  test('opens, selects an item and closes', async () => {
    const onSelect = vi.fn();
    render(<Menu trigger="Actions" items={[{ label: 'Rename', onSelect }]} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
  test('Escape and outside click close it', async () => {
    render(
      <div>
        <Menu trigger="Actions" items={[{ label: 'Rename', onSelect: () => {} }]} />
        <p>outside</p>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
  test('disabled item does not fire', async () => {
    const onSelect = vi.fn();
    render(<Menu trigger="Actions" items={[{ label: 'Delete', onSelect, disabled: true }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Dialog', () => {
  test('renders title and children only when open', () => {
    const { rerender } = render(<Dialog open={false} title="Rename board" onClose={() => {}}>body</Dialog>);
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    rerender(<Dialog open title="Rename board" onClose={() => {}}>body</Dialog>);
    expect(screen.getByRole('dialog', { name: 'Rename board' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  test('close event calls onClose', () => {
    const onClose = vi.fn();
    render(<Dialog open title="T" onClose={onClose}>x</Dialog>);
    screen.getByRole('dialog').dispatchEvent(new Event('close'));
    expect(onClose).toHaveBeenCalled();
  });
});

test('chrome fake dispatches events', async () => {
  const c = installChromeFake();
  const fn = vi.fn();
  c.tabs.onCreated.addListener(fn);
  expect(c.tabs.onCreated.hasListener(fn)).toBe(true);
  await c.tabs.create({ url: 'https://example.com' });
  expect(fn).toHaveBeenCalledOnce();
  expect((await chrome.tabs.query({})).length).toBe(1);
});

describe('Menu keyboard and focus', () => {
  const items = [
    { label: 'One', onSelect: () => {} },
    { label: 'Two', onSelect: () => {}, disabled: true },
    { label: 'Three', onSelect: () => {} },
  ];
  test('focuses first item on open and arrows/Home/End move between enabled items', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Actions" items={items} />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
  });
  test('Escape and select return focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Actions" items={items} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Three' }));
    expect(trigger).toHaveFocus();
  });
});

describe('Dialog focus restoration', () => {
  test('returns focus to the opener when closed', () => {
    function Host({ open }: { open: boolean }) {
      return (
        <div>
          <button>opener</button>
          <Dialog open={open} title="T" onClose={() => {}}>x</Dialog>
        </div>
      );
    }
    const { rerender } = render(<Host open={false} />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    rerender(<Host open />);
    (document.activeElement as HTMLElement)?.blur();
    rerender(<Host open={false} />);
    expect(opener).toHaveFocus();
  });
  test('falls back to returnFocusTo when the opener is gone', () => {
    function Host({ open, withOpener }: { open: boolean; withOpener: boolean }) {
      return (
        <div>
          {withOpener && <button>opener</button>}
          <button>fallback</button>
          <Dialog open={open} title="T" onClose={() => {}} returnFocusTo={() => screen.getByRole('button', { name: 'fallback' })}>x</Dialog>
        </div>
      );
    }
    const { rerender } = render(<Host open={false} withOpener />);
    screen.getByRole('button', { name: 'opener' }).focus();
    rerender(<Host open withOpener />);
    rerender(<Host open={false} withOpener={false} />);
    expect(screen.getByRole('button', { name: 'fallback' })).toHaveFocus();
  });
});

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('boom');
  }
  test('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
  test('a render error shows the message and a Reload button', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReload = vi.fn();
    render(<ErrorBoundary onReload={onReload}><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Reload the page.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
    errors.mockRestore();
  });
});
