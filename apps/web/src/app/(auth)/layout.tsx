import '@/styles/auth.css';

/**
 * The screens outside a session share one stylesheet, loaded here rather than
 * in globals.css: nothing inside a workspace uses these rules, and keeping them
 * with the route group is what lets the brand components be reused elsewhere
 * with their own styles.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
