import axios from "axios";

export async function alertSeparateOut(env: string, msg: string) {
  let url: string;
  if (env === "prod") {
    url = "";
  } else {
    return;
  }
  const body = {
    msg_type: "text",
    content: {
      text: "env=" + env + ", " + msg,
    },
  }

  axios.post(url, body);
}

export async function alertMaker(env: string, msg: string) {
  let url: string;
  if (env === "prod") {
    url = "";
  } else if (env === "test") {
    url = "";
  } else {
    return;
  }
  const body = {
    msg_type: "text",
    content: {
      text: "env=" + env + ", " + msg,
    },
  }

  axios.post(url, body);
}


export async function alertMakerByNetwork(env: string, isTestnet: number, msg: string) {
  let url: string;
  if (env === "prod") {
    if (isTestnet === 0) {
      url = "";
    } else {
      url = "";
    }
  } else if (env === "test") {
    url = "";
  } else {
    return;
  }
  const body = {
    msg_type: "text",
    content: {
      text: "env=" + env + ", " + msg,
    },
  }

  axios.post(url, body);
}

export async function alertDust(env: string, msg: string) {
  let url: string;
  if (env === "prod") {
    url = "";
  } else if (env === "test") {
    return;
  } else {
    return;
  }
  const body = {
    msg_type: "text",
    content: {
      text: "env=" + env + ", " + msg,
    },
  }

  axios.post(url, body);
}


export async function alertCommission(env: string, msg: string) {
  let url: string;
  if (env === "prod") {
    url = "";
  } else if (env === "test") {
    url = "";
  } else {
    return;
  }
  const body = {
    msg_type: "text",
    content: {
      text: "env=" + env + ", " + msg,
    },
  }

  axios.post(url, body);
}

export async function alertCCTP(env: string, msg: string) {
  let url: string;
  if (env === "prod") {
    url = "";
  } else if (env === "test") {
    url = "";
  } else {
    return;
  }
  const body = {
    msg_type: "text",
    content: {
      text: "env=" + env + ", " + msg,
    },
  }

  axios.post(url, body);
}


export async function alertData(url: string, msg: string) {
  const body = {
    msg_type: "text",
    content: {
      text: msg,
    },
  }

  axios.post(url, body);
}

export async function alertPhone(env: string, isTestnet: number, msg: string) {
  const url = "";
  if (env === "prod" && isTestnet === 0) {
    const body = {
      "destPhoneNumber": "+43234234",
      "message": msg,
    }
    axios.post(url, body, { headers: {'content-type': 'application/json'}});
  }
}
