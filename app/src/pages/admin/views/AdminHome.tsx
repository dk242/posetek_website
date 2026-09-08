// The admin home — the same two options the mobile admin shell has.
// "When they sign into the website as admin, they still have the two different
// options for drills library and the monitor accounts page."

import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function AdminHome() {
  useEffect(() => {
    document.title = "Admin | PoseTek";
  }, []);

  return (
    <>
      <section className="admin-heading">
        <div>
          <p className="eyebrow">PoseTek admin</p>
          <h1>What are you working on?</h1>
          <p>Manage clubs and staff, review athlete accounts, and maintain the drill library.</p>
        </div>
      </section>

      <div className="admin-home-options">
        <Link className="admin-home-option" to="/admin/organizations"><span className="material-symbols-outlined">groups</span><h2>Organizations</h2><p>Create clubs and teams, invite coaches and managers, and manage access to athlete rosters.</p></Link>
        <Link className="admin-home-option" to="/admin/drills">
          <span className="material-symbols-outlined">library_books</span>
          <h2>Drill library</h2>
          <p>
            Every drill in the catalog: search by name, sort by domain, read every field, play the
            demo clips, edit them, and create new drills.
          </p>
        </Link>

        <Link className="admin-home-option" to="/admin/accounts">
          <span className="material-symbols-outlined">supervisor_account</span>
          <h2>Monitor accounts</h2>
          <p>
            Into an organization, a coach, then an athlete: their profile inputs, their whole
            training program workout by workout, and the editor for any workout in it.
          </p>
        </Link>

        <Link className="admin-home-option" to="/admin/programs">
          <span className="material-symbols-outlined">auto_awesome</span>
          <h2>Generate programs</h2>
          <p>
            Pick a club's athletes, set weeks, sessions and minutes, and build every training
            program in one go — each job watched live, each plan opened from its row.
          </p>
        </Link>
      </div>
    </>
  );
}
