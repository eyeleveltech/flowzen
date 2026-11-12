import { redirect } from 'next/navigation';

/**
 * Sign-up is closed (12 Nov): Flowzen is this studio's alone, and every
 * account arrives by an admin's invitation. An old link to /register lands
 * on sign-in.
 */
export default function Register() {
  redirect('/login');
}
