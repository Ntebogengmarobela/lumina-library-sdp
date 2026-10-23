let librarianMode = "books";
let librarianSearchTimeout;
let librarianRequestNumber = 0;

const librarianTabSettings = {
  books: "Search book titles, authors, ISBN numbers...",
  members: "Search member names or usernames...",
  loans: "Search loans by member name or book title...",
  returns: "Search the borrowed book or member...",
  fines: "Search overdue books or members...",
  search: "Search books by title or members by name...",
  status: "Search books by title, ISBN or status...",
  weekly: "Search weekly overdue reports...",
  monthly: "Search monthly circulation reports...",
};

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("librarianSearchInput");
  const icon = document.getElementById("librarianSearchIcon");

  if (icon) icon.textContent = "search";

  if (input) {
    input.addEventListener("input", executeLibrarianSearch);
  }
});

function switchLibrarianTab(mode) {
  if (!librarianTabSettings[mode]) return;

  librarianMode = mode;
  librarianRequestNumber++;
  clearTimeout(librarianSearchTimeout);

  document.querySelectorAll(".tab-btn").forEach((tab) => {
    const tabMode =
      tab.dataset.mode || tab.getAttribute("onclick")?.match(/'([^']+)'/)?.[1];

    tab.classList.toggle("active", tabMode === mode);
  });

  const input = document.getElementById("librarianSearchInput");
  const results = document.getElementById("librarianResults");
  const icon = document.getElementById("librarianSearchIcon");

  if (!input || !results) return;

  if (icon) icon.textContent = "search";

  input.placeholder = librarianTabSettings[mode];
  input.value = "";
  results.replaceChildren();

  if (mode === "loans") {
    loadLoanTransactions();
  } else if (mode === "returns") {
    loadLoanTransactions("returns");
  } else if (mode === "fines") {
    loadLoanTransactions("fines");
  } else if (mode === "weekly") {
    loadWeeklyReport();
  } else if (mode === "monthly") {
    loadMonthlyReport();
  }

  if (mode === "members") {
    input.focus();
  } else {
    input.focus();
  }
}

async function executeLibrarianSearch() {
  const input = document.getElementById("librarianSearchInput");
  const results = document.getElementById("librarianResults");

  if (!input || !results) return;

  clearTimeout(librarianSearchTimeout);

  const query = input.value.trim();
  const requestNumber = ++librarianRequestNumber;

  if (!query) {
    results.replaceChildren();
    return;
  }

  if (!["books", "members", "search", "status"].includes(librarianMode)) {
    results.replaceChildren();
    return;
  }

  librarianSearchTimeout = setTimeout(async () => {
    results.textContent = "Searching...";

    try {
      const type = librarianMode === "members" ? "members" : "books";
      const params = new URLSearchParams({ type, q: query });

      const response = await fetch(`/api/search?${params}`);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();

      if (requestNumber !== librarianRequestNumber) return;

      results.replaceChildren();

      if (!Array.isArray(data) || data.length === 0) {
        results.textContent = "No matching records found.";
        return;
      }

      data.forEach((item) => {
        const card = document.createElement("section");
        card.className = "search-result-item";
        card.tabIndex = 0;
        card.setAttribute("role", "button");

        const title = document.createElement("h3");
        title.textContent = item.title || "Untitled";

        const detail = document.createElement("p");
        detail.textContent = item.detail || "";

        const status = document.createElement("span");
        status.textContent = item.status || "";

        const hint = document.createElement("p");
        hint.className = "manage-hint";
        hint.textContent = "Click to manage";

        card.append(title, detail, status, hint);

        card.addEventListener("click", () => {
          openLibrarianRecord(item);
        });

        card.addEventListener("keydown", (event) => {
          if (event.target !== card) return;

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLibrarianRecord(item);
          }
        });

        results.appendChild(card);
      });
    } catch (error) {
      if (requestNumber !== librarianRequestNumber) return;

      console.error("Librarian search error:", error);
      results.textContent = "Search failed. Check that the server is running.";
    }
  }, 250);
}

async function openLibrarianRecord(item) {
  const isMember = librarianMode === "members";
  const recordType = isMember ? "Member" : "Book";

  const action = prompt(
    `${recordType}: ${item.title || "Untitled"}\n\n` +
      "1 - View details\n" +
      "2 - Edit record\n" +
      "3 - Delete record\n\n" +
      "Enter 1, 2 or 3:",
  );

  if (action === null) return;

  const choice = action.trim();

  if (!["1", "2", "3"].includes(choice)) {
    alert("Please enter 1, 2 or 3.");
    return;
  }

  if (isMember) {
    await handleLibrarianMemberAction(choice, item);
  } else {
    await handleLibrarianBookAction(choice, item);
  }
}

async function handleLibrarianBookAction(action, book) {
  if (action === "1") {
    try {
      const response = await fetch("/api/books");

      if (!response.ok) {
        throw new Error("Could not load books.");
      }

      const books = await response.json();
      const fullBook = books.find(
        (entry) => String(entry.id) === String(book.id),
      );

      if (!fullBook) {
        alert("Book not found in the database.");
        return;
      }

      alert(
        "Book Details\n\n" +
          `Title: ${fullBook.title || ""}\n` +
          `Author: ${fullBook.author || ""}\n` +
          `ISBN: ${fullBook.isbn || ""}\n` +
          `Category: ${fullBook.category || ""}\n` +
          `Status: ${fullBook.status || ""}`,
      );
    } catch (error) {
      console.error(error);
      alert(error.message || "Unable to retrieve book details.");
    }

    return;
  }

  if (action === "2") {
    await editLibrarianBook(book);
    return;
  }

  if (action === "3") {
    await deleteLibrarianBook(book);
  }
}

async function editLibrarianBook(book) {
  try {
    const response = await fetch("/api/books");

    if (!response.ok) {
      throw new Error("Could not load books.");
    }

    const books = await response.json();
    const fullBook = books.find(
      (entry) => String(entry.id) === String(book.id),
    );

    if (!fullBook) {
      alert("Book not found.");
      return;
    }

    const title = prompt("Book title:", fullBook.title || "");
    if (title === null) return;

    const author = prompt("Author:", fullBook.author || "");
    if (author === null) return;

    const isbn = prompt("ISBN:", fullBook.isbn || "");
    if (isbn === null) return;

    const category = prompt("Category:", fullBook.category || "General");
    if (category === null) return;

    const status = prompt(
      "Status: Available, Borrowed, Overdue or Reserved",
      fullBook.status || "Available",
    );
    if (status === null) return;

    const updatedBook = {
      title: title.trim(),
      author: author.trim(),
      isbn: isbn.trim(),
      category: category.trim() || "General",
      status: status.trim(),
    };

    if (!updatedBook.title || !updatedBook.author || !updatedBook.isbn) {
      alert("Title, author and ISBN are required.");
      return;
    }

    const allowedStatuses = ["Available", "Borrowed", "Overdue", "Reserved"];

    if (!allowedStatuses.includes(updatedBook.status)) {
      alert("Invalid book status.");
      return;
    }

    const updateResponse = await fetch(`/api/books/${fullBook.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedBook),
    });

    const result = await updateResponse.json();

    if (!updateResponse.ok) {
      throw new Error(result.error || "Book update failed.");
    }

    alert("Book updated successfully!");
    await executeLibrarianSearch();
  } catch (error) {
    console.error("Edit book error:", error);
    alert(error.message || "Unable to update book.");
  }
}

async function deleteLibrarianBook(book) {
  const confirmed = confirm(
    `Are you sure you want to delete "${book.title}"?\n\n` +
      "This will permanently remove the book record.",
  );

  if (!confirmed) return;

  try {
    const response = await fetch(`/api/books/${book.id}`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Book deletion failed.");
    }

    alert("Book deleted successfully!");
    await executeLibrarianSearch();
  } catch (error) {
    console.error("Delete book error:", error);
    alert(error.message || "Unable to delete book.");
  }
}

async function getLibrarianMember(memberId) {
  const response = await fetch("/api/members");

  if (!response.ok) {
    throw new Error("Could not load members from the server.");
  }

  const members = await response.json();

  return members.find((entry) => String(entry.id) === String(memberId));
}

async function handleLibrarianMemberAction(action, member) {
  try {
    // VIEW MEMBER
    if (action === "1") {
      const fullMember = await getLibrarianMember(member.id);

      if (!fullMember) {
        alert("Member not found.");
        return;
      }

      alert(
        "Member Details\n\n" +
          `Member ID: ${fullMember.id}\n` +
          `Full Name: ${fullMember.full_name}\n` +
          `Username: ${fullMember.username}\n` +
          `Role: ${fullMember.role}`,
      );

      return;
    }

    // EDIT MEMBER
    if (action === "2") {
      await editLibrarianMember(member);
      return;
    }

    // DELETE MEMBER
    if (action === "3") {
      await deleteLibrarianMember(member);
    }
  } catch (error) {
    console.error("Member management error:", error);
    alert(error.message || "Unable to manage member.");
  }
}

async function editLibrarianMember(member) {
  try {
    const fullMember = await getLibrarianMember(member.id);

    if (!fullMember) {
      alert("Member not found.");
      return;
    }

    const fullName = prompt(
      "Full name:",
      fullMember.full_name || member.title || "",
    );
    if (fullName === null) return;

    const username = prompt("Username:", fullMember.username || "");
    if (username === null) return;

    const role = prompt(
      "Role (Admin or Librarian):",
      fullMember.role || "Librarian",
    );
    if (role === null) return;

    const updatedMember = {
      full_name: fullName.trim(),
      username: username.trim(),
      role: role.trim(),
    };

    if (
      !updatedMember.full_name ||
      !updatedMember.username ||
      !updatedMember.role
    ) {
      alert("Full name, username and role are required.");
      return;
    }

    const response = await fetch(`/api/members/${fullMember.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedMember),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Member update failed.");
    }

    alert(result.message || "Member updated successfully!");

    await executeLibrarianSearch();
  } catch (error) {
    console.error("Edit member error:", error);
    alert(error.message || "Unable to update member.");
  }
}

async function deleteLibrarianMember(member) {
  let fullMember;

  try {
    fullMember = await getLibrarianMember(member.id);

    if (!fullMember) {
      alert("Member not found.");
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to delete "${fullMember.full_name}"?\n\n` +
        `Username: ${fullMember.username}\n` +
        "This permanently deletes the member account.",
    );

    if (!confirmed) return;

    const response = await fetch(`/api/members/${fullMember.id}`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Member deletion failed.");
    }

    alert(result.message || "Member deleted successfully!");

    await executeLibrarianSearch();
  } catch (error) {
    console.error("Delete member error:", error);
    alert(error.message || "Unable to delete member.");
  }
}

async function loadLoanTransactions(view = "loans") {
  const FINE_PER_DAY = 5; // Change this if your library uses another rate.

  try {
    const response = await fetch("/api/loans");

    if (!response.ok) {
      throw new Error("Could not load loan transactions.");
    }

    const loans = await response.json();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const getOverdueDays = (dueDate) => {
      const due = new Date(`${dueDate}T00:00:00`);
      due.setHours(0, 0, 0, 0);

      if (Number.isNaN(due.getTime()) || due >= today) {
        return 0;
      }

      return Math.floor((today - due) / (1000 * 60 * 60 * 24));
    };

    const filteredLoans =
      view === "returns"
        ? loans.filter((loan) => loan.loan_status !== "Returned")
        : view === "fines"
          ? loans.filter((loan) => {
              return loan.loan_status === "Overdue" && loan.return_date == null;
            })
          : loans;

    if (filteredLoans.length === 0) {
      alert(
        view === "returns"
          ? "No books are currently awaiting return."
          : view === "fines"
            ? "No overdue fines found."
            : "No loan transactions found.",
      );
      return;
    }

    const heading =
      view === "returns"
        ? "BOOK RETURNS"
        : view === "fines"
          ? "OVERDUE FINES"
          : "LOAN TRANSACTIONS";

    const details = filteredLoans.map((loan, index) => {
      let extraDetails = "";

      if (view === "fines") {
        const daysOverdue = getOverdueDays(loan.due_date);
        const fine = daysOverdue * FINE_PER_DAY;

        extraDetails =
          `\nDays Overdue: ${daysOverdue}` +
          `\nFine Per Day: R${FINE_PER_DAY.toFixed(2)}` +
          `\nFine Amount: R${fine.toFixed(2)}`;
      }

      return (
        `${index + 1}. Loan ID: ${loan.id}\n` +
        `Book: ${loan.book_title || "Unknown"}\n` +
        `Member: ${loan.member_name || "Unknown"}\n` +
        `Username: ${loan.member_username || "Unknown"}\n` +
        `Loan Date: ${loan.loan_date || "N/A"}\n` +
        `Due Date: ${loan.due_date || "N/A"}\n` +
        `Return Date: ${loan.return_date || "Not returned"}\n` +
        `Status: ${loan.loan_status || "Unknown"}` +
        extraDetails
      );
    });

    if (view === "returns") {
      alert(`${heading}\n\n${details.join("\n\n--------------------\n\n")}`);

      const loanChoices = filteredLoans
        .map((loan) => `${loan.id} - ${loan.book_title} (${loan.member_name})`)
        .join("\n");

      const selectedId = prompt(
        "Enter the Loan ID of the book being returned:\n\n" +
          loanChoices +
          "\n\nEnter 0 or cancel to go back.",
      );

      if (
        selectedId === null ||
        selectedId.trim() === "" ||
        selectedId.trim() === "0"
      ) {
        return;
      }

      const selectedLoan = filteredLoans.find(
        (loan) => Number(loan.id) === Number(selectedId),
      );

      if (!selectedLoan) {
        alert("Invalid Loan ID. Please select a loan from the list.");
        return;
      }

      const confirmed = confirm(
        `Confirm book return?\n\n` +
          `Book: ${selectedLoan.book_title}\n` +
          `Member: ${selectedLoan.member_name}\n` +
          `Loan ID: ${selectedLoan.id}`,
      );

      if (!confirmed) return;

      const returnResponse = await fetch(
        `/api/loans/${selectedLoan.id}/return`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const result = await returnResponse.json();

      if (!returnResponse.ok) {
        throw new Error(result.error || "Could not return the book.");
      }

      alert(result.message || "Book returned successfully!");
      await loadLoanTransactions("returns");
      return;
    }

    alert(`${heading}\n\n${details.join("\n\n--------------------\n\n")}`);
  } catch (error) {
    console.error("Loan/return/fines error:", error);

    alert("Could not process the request.\n\n" + error.message);
  }
}

async function loadWeeklyReport() {
  try {
    const response = await fetch("/api/loans");

    if (!response.ok) {
      throw new Error("Could not load loan data.");
    }

    const loans = await response.json();

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    function parseLocalDate(value) {
      if (!value) return null;

      const parsed = new Date(
        value.length === 10 ? `${value}T00:00:00` : value,
      );

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function isWithinLastSevenDays(value) {
      const date = parseLocalDate(value);
      return date && date >= sevenDaysAgo && date <= now;
    }

    const borrowedThisWeek = loans.filter((loan) =>
      isWithinLastSevenDays(loan.loan_date),
    );

    const returnedThisWeek = loans.filter((loan) =>
      isWithinLastSevenDays(loan.return_date),
    );

    const overdueLoans = loans.filter((loan) => loan.loan_status === "Overdue");

    const activeLoans = loans.filter((loan) => loan.loan_status === "Active");

    const outstandingLoans = loans.filter(
      (loan) => loan.loan_status !== "Returned",
    );

    const transactionDetails = borrowedThisWeek.length
      ? borrowedThisWeek
          .map(
            (loan, index) =>
              `${index + 1}. ${loan.book_title || "Unknown book"}\n` +
              `   Member: ${loan.member_name || "Unknown"}\n` +
              `   Borrowed: ${loan.loan_date || "N/A"}\n` +
              `   Due: ${loan.due_date || "N/A"}\n` +
              `   Status: ${loan.loan_status}`,
          )
          .join("\n\n")
      : "No books were borrowed during this period.";

    const returnedDetails = returnedThisWeek.length
      ? returnedThisWeek
          .map(
            (loan, index) =>
              `${index + 1}. ${loan.book_title || "Unknown book"}\n` +
              `   Member: ${loan.member_name || "Unknown"}\n` +
              `   Returned: ${loan.return_date}`,
          )
          .join("\n\n")
      : "No books were returned during this period.";

    const report =
      "LUMINA LIBRARY\n" +
      "WEEKLY REPORT - LAST 7 DAYS\n" +
      `Generated: ${now.toLocaleString()}\n\n` +
      "========== SUMMARY ==========\n" +
      `Books borrowed this week: ${borrowedThisWeek.length}\n` +
      `Books returned this week: ${returnedThisWeek.length}\n` +
      `Currently active loans: ${activeLoans.length}\n` +
      `Currently overdue books: ${overdueLoans.length}\n` +
      `Total books still on loan: ${outstandingLoans.length}\n\n` +
      "====== BORROWING ACTIVITY ======\n" +
      transactionDetails +
      "\n\n====== RETURNS THIS WEEK ======\n" +
      returnedDetails;

    alert(report);
  } catch (error) {
    console.error("Weekly report error:", error);

    alert("Could not generate the weekly report.\n\n" + error.message);
  }
}


async function loadMonthlyReport() {
  try {
    const response = await fetch("/api/reports/monthly");

    if (!response.ok) {
      throw new Error("Could not load the monthly report.");
    }

    const reports = await response.json();

    if (!reports.length) {
      alert("MONTHLY LIBRARY REPORT\n\nNo loan transactions recorded yet.");
      return;
    }

    let reportMessage = "MONTHLY LIBRARY REPORT\n";
    reportMessage += "==============================\n\n";

    reports.forEach((report) => {
      reportMessage += `Month: ${report.month}\n`;
      reportMessage += `Total Loans: ${report.total_loans}\n`;
      reportMessage += `Returned Books: ${report.returned}\n`;
      reportMessage += `Active Loans: ${report.active}\n`;
      reportMessage += `Overdue Books: ${report.overdue}\n`;
      reportMessage += "------------------------------\n\n";
    });

    alert(reportMessage);
  } catch (error) {
    console.error("Monthly report error:", error);
    alert("Could not load the monthly report. Please try again.");
  }
}
