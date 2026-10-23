let currentSearchMode = "books";
let searchTimeout;
let searchRequestNumber = 0;

function switchSearchMode(mode) {
  if (mode !== "books" && mode !== "members") return;

  currentSearchMode = mode;

  const input = document.getElementById("dashboardSearchInput");
  const tabs = document.querySelectorAll(".tab-btn");

  if (!input) return;

  tabs.forEach((tab, index) => {
    tab.classList.toggle(
      "active",
      mode === "books" ? index === 0 : index === 1,
    );
  });

  input.placeholder =
    mode === "books"
      ? "Search titles, authors, ISBN numbers..."
      : "Search member names or usernames...";

  executeLiveSearchSearch();
}

async function executeLiveSearchSearch() {
  const input = document.getElementById("dashboardSearchInput");
  const container = document.getElementById("searchResultsContainer");

  if (!input || !container) return;

  clearTimeout(searchTimeout);

  const query = input.value.trim();
  const requestNumber = ++searchRequestNumber;

  if (!query) {
    container.replaceChildren();
    return;
  }

  searchTimeout = setTimeout(async () => {
    container.textContent = "Searching...";

    try {
      const params = new URLSearchParams({
        type: currentSearchMode,
        q: query,
      });

      const response = await fetch(`/api/search?${params}`);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const results = await response.json();

      if (requestNumber !== searchRequestNumber) return;

      container.replaceChildren();

      if (!Array.isArray(results) || results.length === 0) {
        container.textContent = `No matching ${currentSearchMode} found.`;
        return;
      }

      results.forEach((item) => {
        const card = document.createElement("div");
        card.className = "search-result-item";
        card.style.cursor = "pointer";
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");

        const title = document.createElement("h3");
        title.textContent = item.title || "Untitled";

        const detail = document.createElement("p");
        detail.textContent = item.detail || "";

        const status = document.createElement("span");
        status.textContent = item.status || "";

        const hint = document.createElement("small");
        hint.textContent = "Click to manage";
        hint.className = "manage-hint";
        hint.style.display = "block";
        hint.style.marginTop = "8px";

        card.append(title, detail, status, hint);

        card.addEventListener("click", () => {
          openManagementOptions(item);
        });

        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openManagementOptions(item);
          }
        });

        container.appendChild(card);
      });
    } catch (error) {
      if (requestNumber !== searchRequestNumber) return;

      console.error("Search error:", error);
      container.textContent =
        "Search failed. Check that the server is running.";
    }
  }, 250);
}

function openManagementOptions(item) {
  const isBook = currentSearchMode === "books";
  const itemType = isBook ? "Book" : "Member";

  const action = prompt(
    `${itemType}: ${item.title}\n\n` +
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

  if (isBook) {
    handleBookAction(choice, item);
  } else {
    handleMemberAction(choice, item);
  }
}

// BOOK MANAGEMENT

async function handleBookAction(action, book) {
  if (action === "1") {
    try {
      const response = await fetch("/api/books");

      if (!response.ok) throw new Error("Could not load books.");

      const books = await response.json();
      const fullBook = books.find((entry) => entry.id === book.id);

      if (!fullBook) {
        alert("Book not found in the database.");
        return;
      }

      alert(
        `Book Details\n\n` +
          `Title: ${fullBook.title}\n` +
          `Author: ${fullBook.author}\n` +
          `ISBN: ${fullBook.isbn}\n` +
          `Category: ${fullBook.category}\n` +
          `Status: ${fullBook.status}`,
      );
    } catch (error) {
      console.error(error);
      alert("Unable to retrieve book details.");
    }

    return;
  }

  if (action === "2") {
    await editBook(book);
    return;
  }

  if (action === "3") {
    await deleteBook(book);
  }
}

async function editBook(book) {
  try {
    // Retrieve the complete book record.
    const response = await fetch("/api/books");

    if (!response.ok) throw new Error("Could not load books.");

    const books = await response.json();
    const fullBook = books.find((entry) => entry.id === book.id);

    if (!fullBook) {
      alert("Book not found.");
      return;
    }

    const title = prompt("Book title:", fullBook.title);
    if (title === null) return;

    const author = prompt("Author:", fullBook.author);
    if (author === null) return;

    const isbn = prompt("ISBN:", fullBook.isbn);
    if (isbn === null) return;

    const category = prompt("Category:", fullBook.category || "General");
    if (category === null) return;

    const status = prompt(
      "Status: Available, Borrowed, Overdue or Reserved",
      fullBook.status,
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
      alert("Invalid status. Choose Available, Borrowed, Overdue or Reserved.");
      return;
    }

    const updateResponse = await fetch(`/api/books/${fullBook.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedBook),
    });

    const result = await updateResponse.json();

    if (!updateResponse.ok) {
      throw new Error(result.error || "Book update failed.");
    }

    alert("Book updated successfully!");

  
    executeLiveSearchSearch();
  } catch (error) {
    console.error("Edit book error:", error);
    alert(error.message || "Unable to update book.");
  }
}

async function deleteBook(book) {
  const confirmed = confirm(
    `Are you sure you want to delete "${book.title}"?\n\n` +
      "This will permanently remove the book record.",
  );

  if (!confirmed) return;

  try {
    const response = await fetch(`/api/books/${book.id}`, { method: "DELETE" });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Book deletion failed.");
    }

    alert("Book deleted successfully!");

    // Refresh results using the existing search.
    executeLiveSearchSearch();
  } catch (error) {
    console.error("Delete book error:", error);
    alert(error.message || "Unable to delete book.");
  }
}


function handleMemberAction(action, member) {
  if (action === "1") {
    alert(
      `Member Details\n\n` +
        `Name: ${member.title}\n` +
        `Details: ${member.detail || "Not available"}`,
    );
  } else if (action === "2") {
    alert(
      "Member editing is not connected yet. " +
        "We need to add a member update endpoint in server.js.",
    );
  } else if (action === "3") {
    alert(
      "Member deletion is not connected yet. " +
        "We need to add a member delete endpoint in server.js.",
    );
  }
}
