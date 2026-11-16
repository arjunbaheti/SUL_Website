import type { Metadata } from "next";
import { Suspense } from "react";
import { Header, ShortFooter } from "@/components/chrome";
import { BookingPage } from "@/components/booking/booking-page";

// A candidate's private interview booking page. Linked only from their invite email.
export const metadata: Metadata = {
  title: "Book your interview",
  robots: { index: false, follow: false },
  referrer: "no-referrer", // keep the private token out of other sites' logs
};

// The token is only known per request, so that part streams in behind a loading state.
async function Booking({ params }: { params: PageProps<"/book/[token]">["params"] }) {
  const { token } = await params;
  return <BookingPage token={token} />;
}

const Loading = () => (
  <div className="book-card book-loading" aria-busy="true"><span className="book-spinner" />Loading your booking…</div>
);

export default function BookPage({ params }: PageProps<"/book/[token]">) {
  return (
    <>
      <Header />
      <main id="main">
        <section className="section book-section">
          <div className="container book-wrap">
            <Suspense fallback={<Loading />}>
              <Booking params={params} />
            </Suspense>
          </div>
        </section>
      </main>
      <ShortFooter />
    </>
  );
}
