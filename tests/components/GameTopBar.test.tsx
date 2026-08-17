import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GameTopBar } from '../../src/app/game/[id]/GameTopBar';

afterEach(cleanup);

const continueAction = vi.fn(async () => undefined);

describe('GameTopBar', () => {
  it('shows Back and Continue independently when both are available', () => {
    render(<GameTopBar backHref="/t/east-tag" continueAction={continueAction} />);

    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/t/east-tag');
    expect(screen.getByRole('button', { name: 'Continue match' })).toBeDefined();
  });

  it('shows Continue without requiring a Back destination', () => {
    render(<GameTopBar backHref={null} continueAction={continueAction} />);

    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue match' })).toBeDefined();
  });

  it('shows Back without Continue when resuming is unavailable', () => {
    render(<GameTopBar backHref="/t/east-tag" />);

    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/t/east-tag');
    expect(screen.queryByRole('button', { name: 'Continue match' })).toBeNull();
  });

  it('renders no bar when neither control is available', () => {
    const { container } = render(<GameTopBar backHref={null} />);

    expect(container.firstChild).toBeNull();
  });
});
