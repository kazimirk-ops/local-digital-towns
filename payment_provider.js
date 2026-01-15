class PaymentProvider {
  async createPaymentIntent({ amountCents, currency, metadata }) {
    throw new Error("Not implemented");
  }
  async capturePaymentIntent(paymentIntentId) {
    throw new Error("Not implemented");
  }
}

class StubPaymentProvider extends PaymentProvider {
  async createPaymentIntent({ amountCents, currency, metadata }) {
    return {
      provider: "stub",
      paymentIntentId: `pi_stub_${Date.now()}`,
      amountCents,
      currency: currency || "usd",
      metadata: metadata || {},
      status: "requires_confirmation"
    };
  }
  async capturePaymentIntent(paymentIntentId) {
    return { provider: "stub", paymentIntentId, status: "succeeded" };
  }
}

// TODO: Replace StubPaymentProvider with Stripe Connect (Express accounts).
// TODO: Implement createPaymentIntent + capturePaymentIntent using Stripe API.
// TODO: Persist provider account mapping per store owner.

module.exports = { PaymentProvider, StubPaymentProvider };
