# Technical Architecture Proposal: iYogaU Integrated Platform

To fulfill the requirement of built-in functionality (Journaling, Newsletter, Mentor Feedback) and ensure a future transition to a mobile app, I propose the following architecture.

---

## 1. High-Level Architecture: The "Hybrid" Jamstack
We will keep the current high-performance static frontend for SEO and marketing, but augment it with a **Serverless Backend** for private student features.

### A. Frontend: React/Next.js (Transition from Static HTML)
*   **Why:** While the current HTML is fast, a component-based framework like Next.js will make building the complex "Journaling Dashboard" much more efficient and allow for better state management in the mobile app.
*   **Mobile Path:** Using Next.js allows us to leverage **Capacitor** later to ship the same code as a native mobile app.

### B. Backend-as-a-Service (BaaS): Supabase
*   **Database (PostgreSQL):** Stores user profiles, journal entries, and mentor comments.
*   **Authentication:** Handles secure sign-ins (Email, Google, or Magic Links).
*   **Real-time Subscriptions:** Allows the student to see a "Mentor is typing..." indicator or receive an instant notification when Ali Karimi leaves feedback on a journal entry.
*   **Edge Functions:** Handles the "Newsletter" subscription logic and sends automated welcome emails to HNWIs.

---

## 2. Feature-Specific Design

### A. The Private Journaling Module
1.  **Student View:** A minimalist, "Zen" writing interface (no distractions). Support for Rich Text and perhaps voice-to-text for on-the-go reflections.
2.  **Mentor View (Ali's Dashboard):** A specialized view for Ali to see a chronological feed of all active students' journals, with the ability to "Inline Comment" on specific sentences.
3.  **Privacy:** End-to-end encryption for journal entries to ensure the absolute privacy required by HNWIs.

### B. Newsletter & Lead Capture
1.  **Lead Scoring:** Instead of a simple email list, integrate with an Edge Function that tags leads based on their "Interest Level" (e.g., did they view the $5,000 course page multiple times?).
2.  **Email Delivery:** Use **Postmark** or **Resend** for high-deliverability, beautiful transactional emails (Application received, Mentor replied, etc.).

---

## 3. The Mobile App Strategy (PWA to Native)

### Phase 1: Progressive Web App (PWA)
*   Add a `manifest.json` and a Service Worker.
*   Users can "Add to Home Screen" from Safari/Chrome.
*   **Benefit:** Zero cost, instant updates, no App Store approval needed.

### Phase 2: Native Wrapper (Capacitor)
*   Wrap the PWA in **Capacitor.js**.
*   Access native features: Push Notifications (crucial for "Mentor Replied" alerts) and Biometric Auth (FaceID for journal privacy).
*   Submit to Apple App Store and Google Play Store as "iYogaU: Inner Transformation."

---

## 4. Scalability & Security
*   **GDPR/CCPA Compliance:** Since the brand operates in the USA and China, we will use Supabase's regional hosting to ensure data residency compliance if required.
*   **Security:** JWT-based row-level security (RLS) ensures that a student can *only* ever read/write their own journals, and Ali can only see the students assigned to him.
