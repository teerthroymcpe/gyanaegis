import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the sign-in screen', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /gyanaegis cloud hub/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
