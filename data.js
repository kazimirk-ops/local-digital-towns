// Town + economy data (in-memory)

const town = {
  id: 1,
  name: "Sebastian",
  state: "FL",
  region: "Treasure Coast",
  status: "active",
};

const districts = [
  { id: 1, townId: 1, name: "Market Square", type: "market" },
  { id: 2, townId: 1, name: "Service Row", type: "service" },
  { id: 3, townId: 1, name: "Retail Way", type: "retail" },
  { id: 4, townId: 1, name: "Marina / Live Hall", type: "live" },
  { id: 5, townId: 1, name: "Town Hall", type: "civic" },
];

const places = [
  { id: 101, townId: 1, districtId: 1, name: "Saturday Market Booth A", category: "hybrid", status: "open" },
  { id: 102, townId: 1, districtId: 1, name: "Joe's Produce", category: "grower", status: "open" },

  { id: 201, townId: 1, districtId: 2, name: "Riverfront Plumbing", category: "service", status: "open" },
  { id: 202, townId: 1, districtId: 2, name: "Sebastian Lawn & Landscape", category: "service", status: "open" },

  { id: 301, townId: 1, districtId: 3, name: "Coastal Outfitters", category: "retail", status: "open" },
  { id: 302, townId: 1, districtId: 3, name: "Harbor Gift Shop", category: "retail", status: "open" },

  { id: 401, townId: 1, districtId: 4, name: "Sebastian Auction Hall", category: "live", status: "open" },

  { id: 501, townId: 1, districtId: 5, name: "Town Hall Desk", category: "civic", status: "open" },
];

// Listings
let listings = [
  {
    id: 9001,
    placeId: 102,
    title: "Bell Peppers (5 lb bag)",
    description: "Fresh, local. Pickup today.",
    quantity: 10,
    price: 12,
    status: "active",
  },
  {
    id: 9002,
    placeId: 301,
    title: "Coastal Hat",
    description: "One size fits most.",
    quantity: 5,
    price: 20,
    status: "active",
  },
];

let nextListingId = 9003;

// Messaging
let conversations = [
  { id: 1, placeId: 102, participant: "buyer" },
];

let messages = [
  {
    id: 1,
    conversationId: 1,
    sender: "buyer",
    text: "Hi, are the bell peppers still available?",
    createdAt: new Date().toISOString(),
    readBy: ["buyer"],
  },
];

let nextConversationId = 2;
let nextMessageId = 2;

// Helpers
const getConversationsForPlace = (placeId) =>
  conversations.filter((c) => c.placeId === Number(placeId));

const getUnreadCount = (conversationId, viewer = "buyer") =>
  messages.filter(
    (m) =>
      m.conversationId === Number(conversationId) &&
      (!m.readBy || !m.readBy.includes(viewer))
  ).length;

const markConversationRead = (conversationId, viewer = "buyer") => {
  const cid = Number(conversationId);
  messages = messages.map((m) => {
    if (m.conversationId !== cid) return m;
    const readBy = Array.isArray(m.readBy) ? m.readBy : [];
    if (!readBy.includes(viewer)) readBy.push(viewer);
    return { ...m, readBy };
  });
  return true;
};

module.exports = {
  town,
  districts,
  places,

  // Listings
  getListings: () => listings,
  addListing: (listing) => (listings.push(listing), listing),
  nextListingId: () => nextListingId++,

  // Messaging
  getConversations: () => conversations,
  addConversation: (conversation) => (conversations.push(conversation), conversation),
  nextConversationId: () => nextConversationId++,

  getMessages: () => messages,
  addMessage: (message) => {
    if (!message.readBy) message.readBy = [message.sender || "buyer"];
    messages.push(message);
    return message;
  },
  nextMessageId: () => nextMessageId++,

  // Option 1 helpers
  getConversationsForPlace,
  getUnreadCount,
  markConversationRead,
};

