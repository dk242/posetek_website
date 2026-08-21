// Port of legacy privacy.html.
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { injectClarity } from "./clarity";
import "./privacy.scss";

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy | PoseTek";
    injectClarity();
    window.scrollTo(0, 0); // full-page-load parity

  }, []);

  return (
    <div className="pt-privacy">
      <header>
        <Link to="/" className="logo">Pose<span>Tek</span></Link>
        <Link to="/" className="back-btn">← Home</Link>
      </header>

      <main>
        <div className="page-header">
          <div className="eyebrow">Legal</div>
          <h1>Privacy Policy</h1>
          <p className="last-updated">Last updated: March 4, 2026</p>
        </div>

        <section>
          <h2><span className="section-num">1</span> Overview</h2>
          <p>PoseTek ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your personal information when you use our website and services at <a href="https://kickai-69dd0.web.app">kickai-69dd0.web.app</a>.</p>
          <p>By using PoseTek, you agree to the collection and use of information as described in this policy.</p>
        </section>

        <section>
          <h2><span className="section-num">2</span> Information We Collect</h2>
          <p>We collect the following types of information:</p>
          <ul>
            <li><strong>Account information</strong> — your name, email address, and password (stored securely via Firebase Authentication)</li>
            <li><strong>Player profile data</strong> — field position, organization/team affiliation, and player codes used during signup</li>
            <li><strong>Performance data</strong> — session recordings, biomechanical metrics, rep data, and AI-generated analysis results</li>
            <li><strong>Payment information</strong> — for Premium purchases, payment is processed entirely by Stripe. PoseTek does not store your card number or banking details</li>
            <li><strong>Interest signup data</strong> — name, email, and position submitted through our Player Interest Signup form</li>
            <li><strong>Usage data</strong> — pages visited, features used, and general interaction data collected through Firebase Analytics</li>
          </ul>
        </section>

        <section>
          <h2><span className="section-num">3</span> How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Create and manage your account</li>
            <li>Deliver performance analysis and personalized coaching feedback</li>
            <li>Send email communications related to your analysis results and account activity</li>
            <li>Process Premium payments securely through Stripe</li>
            <li>Improve our platform and features based on usage patterns</li>
            <li>Respond to support inquiries</li>
          </ul>
          <p>We do not sell your personal information to third parties.</p>
        </section>

        <section>
          <h2><span className="section-num">4</span> Third-Party Services</h2>
          <p>PoseTek uses the following third-party services to operate:</p>
          <ul>
            <li><strong>Firebase (Google)</strong> — authentication, database storage, file storage, and hosting. Subject to <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a>.</li>
            <li><strong>Stripe</strong> — payment processing for Premium access. Subject to <a href="https://stripe.com/privacy" target="_blank" rel="noopener">Stripe's Privacy Policy</a>. PoseTek never sees or stores your full payment card details.</li>
            <li><strong>Google Fonts</strong> — font delivery. Subject to <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a>.</li>
          </ul>
        </section>

        <section>
          <h2><span className="section-num">5</span> Data Retention</h2>
          <p>We retain your account and performance data for as long as your account is active or as needed to provide our services. You may request deletion of your account and associated data at any time by contacting us.</p>
          <p>Payment records are retained as required for financial and legal compliance purposes.</p>
        </section>

        <section>
          <h2><span className="section-num">6</span> Data Security</h2>
          <p>We take reasonable technical measures to protect your data, including:</p>
          <ul>
            <li>Passwords are hashed and managed by Firebase Authentication — we never store plain-text passwords</li>
            <li>All data in transit is encrypted via HTTPS/TLS</li>
            <li>Firebase Security Rules restrict database access to authenticated users only</li>
          </ul>
          <p>No method of transmission over the internet is 100% secure. We strive to use commercially acceptable means to protect your information but cannot guarantee absolute security.</p>
        </section>

        <section>
          <h2><span className="section-num">7</span> Children's Privacy</h2>
          <p>PoseTek is intended for use by athletes and coaches. If a user is under the age of 13, their account must be created and managed by a parent or guardian. We do not knowingly collect personal information from children under 13 without parental consent.</p>
          <p>If you believe we have inadvertently collected data from a child under 13 without consent, please contact us immediately so we can delete it.</p>
        </section>

        <section>
          <h2><span className="section-num">8</span> Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your account and data</li>
            <li>Opt out of non-essential communications</li>
          </ul>
          <p>To exercise any of these rights, contact us using the details below.</p>
        </section>

        <section>
          <h2><span className="section-num">9</span> Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this page. Continued use of PoseTek after changes constitutes acceptance of the revised policy.</p>
        </section>

        <section>
          <h2><span className="section-num">10</span> Contact Us</h2>
          <p>If you have questions or concerns about this Privacy Policy or your data, please reach out:</p>
          <div className="contact-box">
            <strong>PoseTek</strong><br />
            Email: <a href="mailto:support@posetek.app">support@posetek.app</a>
          </div>
        </section>
      </main>

      <footer>
        <p>© 2026 PoseTek · <Link to="/">Home</Link> · <Link to="/privacy">Privacy Policy</Link></p>
      </footer>
    </div>
  );
}
