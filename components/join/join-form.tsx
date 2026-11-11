"use client";

import { useState } from "react";

// Prototype: opens a pre-filled email to the club rather than storing membership data anywhere.
export function JoinForm() {
  const [done, setDone] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const lines = [
      "Name: " + data.get("name"),
      "Student email: " + data.get("email"),
      "Degree: " + data.get("degree"),
      "Year: " + data.get("year"),
      "Interested in: " + data.get("interests"),
    ];
    window.location.href =
      "mailto:info@startuplinkunimelb.net?subject=" +
      encodeURIComponent("New membership signup: " + data.get("name")) +
      "&body=" +
      encodeURIComponent(lines.join("\n"));
    setDone(true);
  }

  return (
    <form className="card" id="join-form" data-spotlight="" onSubmit={onSubmit}>
      <div className="form-field">
        <label htmlFor="name">Full name</label>
        <input type="text" id="name" name="name" required autoComplete="name" />
      </div>
      <div className="form-field">
        <label htmlFor="email">Student email</label>
        <input type="email" id="email" name="email" required autoComplete="email" placeholder="you@student.unimelb.edu.au" />
      </div>
      <div className="grid grid-2">
        <div className="form-field">
          <label htmlFor="degree">Degree</label>
          <input type="text" id="degree" name="degree" placeholder="e.g. BCom / BSc" />
        </div>
        <div className="form-field">
          <label htmlFor="year">Year level</label>
          <select id="year" name="year">
            {["1st year", "2nd year", "3rd year", "4th year+", "Postgrad"].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="interests">What are you most interested in?</label>
        <select id="interests" name="interests">
          {["Finding a startup job", "Meeting founders / networking", "Building my own startup", "Skills workshops", "Not sure yet"].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary btn-block" data-magnetic="" type="submit">Join the club</button>
      <p className="form-hint" id="join-confirmation" role="status" aria-live="polite">
        {done ? "Almost done. Hit send in the email that just opened and you're in. (Didn't open? Email info@startuplinkunimelb.net directly.)" : ""}
      </p>
    </form>
  );
}
