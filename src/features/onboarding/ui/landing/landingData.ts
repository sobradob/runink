/**
 * Social-proof quotes shown on the landing page.
 *
 * PLACEHOLDER CONTENT (BOA-116): these are real early-user reactions captured
 * as placeholders. Swap the wording / add attribution (avatar, location, Strava
 * handle) once we have explicit permission to attribute them publicly. Keep the
 * shape stable so the SocialProof section needs no changes when they're updated.
 */
export interface Testimonial {
  quote: string;
  name: string;
}

export const TESTIMONIALS: Testimonial[] = [
  { quote: 'This is a cool idea.', name: 'Alex Kidwell' },
  { quote: 'There is [...] enough proof for me to connect my Strava', name: 'Tim Groot' },
];
