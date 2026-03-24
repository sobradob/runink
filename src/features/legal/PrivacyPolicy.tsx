export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white/80">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <a
          href="/"
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          &larr; Back to RunInk
        </a>

        <h1
          className="text-3xl tracking-[0.15em] uppercase mt-8 mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Privacy Policy
        </h1>
        <p className="text-white/30 text-sm mb-12">
          Effective date: March 24, 2026
        </p>

        <div className="space-y-10 text-sm leading-relaxed text-white/60">
          <section>
            <h2 className="text-white text-base font-medium mb-3">1. Who We Are</h2>
            <p>
              RunInk is operated by <strong className="text-white/80">Tempisque Technology Company</strong>,
              a Delaware LLC located at 2261 Market Street STE 85081, San Francisco, CA 94114, United States.
            </p>
            <p className="mt-2">
              RunInk transforms your running and fitness activity data into beautiful, printable map posters.
              For any privacy-related inquiries, contact us at{' '}
              <a href="mailto:boaz@runink.app" className="text-white/80 underline">boaz@runink.app</a>.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">2. Data We Collect</h2>
            <p>When you use RunInk, we collect and process the following data:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white/80">Fitness activity data</strong> from Strava and/or Garmin Connect,
                including: GPS tracks (route coordinates), activity type, distance, duration, pace,
                elevation, timestamps, and activity titles.
              </li>
              <li>
                <strong className="text-white/80">Basic profile information</strong> from your connected
                fitness account (name, profile ID) to associate your activities.
              </li>
              <li>
                <strong className="text-white/80">Session data</strong>: authentication tokens and session
                identifiers stored in HTTP-only cookies.
              </li>
              <li>
                <strong className="text-white/80">Order information</strong>: when you purchase a poster,
                we collect your shipping address and email for order fulfillment. Payment details are
                processed directly by Stripe and never stored on our servers.
              </li>
            </ul>
            <p className="mt-2">
              We do not collect health metrics, heart rate data, weight, or any medical information.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">3. How We Use Your Data</h2>
            <p>Your data is used exclusively to provide the RunInk service:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Rendering your running routes on map-based poster designs</li>
              <li>Displaying activity statistics (distance, pace, date) on your posters</li>
              <li>Fulfilling print orders through our printing partner</li>
              <li>Processing gift code purchases and redemptions</li>
            </ul>
            <p className="mt-3">
              <strong className="text-white/80">We do not sell, rent, or share your fitness data with any
              third party for advertising, analytics, or any purpose unrelated to poster generation and
              order fulfillment.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">4. Third-Party Services</h2>
            <p>RunInk integrates with the following third-party services:</p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>
                <strong className="text-white/80">Strava API</strong> &mdash; to import your running
                activities and GPS data. Governed by{' '}
                <a href="https://www.strava.com/legal/privacy" className="underline" target="_blank" rel="noopener noreferrer">
                  Strava&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong className="text-white/80">Garmin Connect API</strong> &mdash; to import your
                running activities and GPS data. Governed by{' '}
                <a href="https://www.garmin.com/en-US/privacy/connect/" className="underline" target="_blank" rel="noopener noreferrer">
                  Garmin&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong className="text-white/80">Stripe</strong> &mdash; to process payments securely.
                Your payment information is handled entirely by Stripe and never touches our servers.
                See{' '}
                <a href="https://stripe.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">
                  Stripe&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong className="text-white/80">Printful</strong> &mdash; to print and ship your posters.
                We share only your shipping address and the poster image with Printful for fulfillment.
                See{' '}
                <a href="https://www.printful.com/policies/privacy" className="underline" target="_blank" rel="noopener noreferrer">
                  Printful&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong className="text-white/80">Amazon Web Services (S3)</strong> &mdash; to store
                generated poster images securely.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">5. Data Storage and Security</h2>
            <p>
              Your activity data and account information are stored on secure servers. Poster images are
              stored in Amazon S3 with restricted access. All data is transmitted over HTTPS.
            </p>
            <p className="mt-2">
              We implement reasonable technical and organizational measures to protect your data against
              unauthorized access, alteration, or destruction.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">6. Data Retention</h2>
            <p>
              We retain your fitness activity data only while your account is connected. When you
              disconnect your Strava or Garmin account, your cached activity data is removed from our
              servers.
            </p>
            <p className="mt-2">
              Order records (shipping address, order details) are retained for accounting and customer
              support purposes for up to 24 months after the order date.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white/80">Disconnect</strong> your Strava or Garmin account at
                any time, which stops further data access and removes cached activity data.
              </li>
              <li>
                <strong className="text-white/80">Request deletion</strong> of all your data by contacting
                us at <a href="mailto:boaz@runink.app" className="text-white/80 underline">boaz@runink.app</a>.
              </li>
              <li>
                <strong className="text-white/80">Request access</strong> to the data we hold about you.
              </li>
              <li>
                <strong className="text-white/80">Revoke API access</strong> directly through your Strava
                or Garmin account settings.
              </li>
            </ul>
            <p className="mt-2">
              We will respond to all data requests within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">8. Cookies</h2>
            <p>
              RunInk uses only essential cookies required for the service to function:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-white/80">Session cookies</strong> to maintain your authenticated
                session after connecting your Strava or Garmin account.
              </li>
            </ul>
            <p className="mt-2">
              We do not use advertising cookies, tracking pixels, or third-party analytics cookies.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">9. Children&apos;s Privacy</h2>
            <p>
              RunInk is not directed at children under the age of 16. We do not knowingly collect data
              from children. If you believe a child has provided us with personal data, please contact
              us and we will promptly delete it.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. Material changes will be indicated by
              updating the effective date at the top of this page. Continued use of RunInk after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-white text-base font-medium mb-3">11. Contact</h2>
            <p>
              For questions about this privacy policy or your data, contact:
            </p>
            <div className="mt-2">
              <p>Tempisque Technology Company</p>
              <p>2261 Market Street STE 85081</p>
              <p>San Francisco, CA 94114</p>
              <p>United States</p>
              <p className="mt-2">
                Email:{' '}
                <a href="mailto:boaz@runink.app" className="text-white/80 underline">boaz@runink.app</a>
              </p>
            </div>
          </section>
        </div>

        <div className="mt-16 pt-6 border-t border-white/10 text-xs text-white/20">
          &copy; {new Date().getFullYear()} Tempisque Technology Company. All rights reserved.
        </div>
      </div>
    </div>
  );
}
