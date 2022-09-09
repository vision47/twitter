const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
// const format = require("date-fns/format");

const app = express();
app.use(express.json());
let db = null;
const dbPath = path.join(__dirname, "./twitterClone.db");

const initializeServerAndDB = async () => {
  try {
    app.listen(3000, () => {
      console.log(`Server is running at http://localhost:3000/`);
    });

    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeServerAndDB();

// Register
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `
  SELECT * FROM user WHERE username LIKE '${username}';`;
  const user = await db.get(getUserQuery);
  if (user === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send(`Password is too short`);
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const addUserQuery = `
        INSERT INTO user (name, username, password, gender)
        VALUES 
        ('${name}','${username}','${hashedPassword}','${gender}');`;
      const dbResponse = await db.run(addUserQuery);
      //   response.send(dbResponse);
      response.status(200);
      response.send(`User created successfully`);
    }
  } else {
    response.status(400);
    response.send(`User already exists`);
  }
});

// login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
  SELECT * FROM user WHERE username LIKE '${username}';`;
  const user = await db.get(getUserQuery);
  if (user === undefined) {
    response.status(400);
    response.send(`Invalid user`);
  } else {
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (isPasswordMatch) {
      const payload = {
        username: username,
        userID: user.user_id,
      };
      const token = jwt.sign(payload, `SECRET_KEY`);
      const jwtToken = {
        jwtToken: token,
      };
      response.status(200);
      response.send(jwtToken);
      console.log(token);
    } else {
      response.status(400);
      response.send(`Invalid password`);
    }
  }
});

// authenticate JWT Token
const tokenAuthentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    console.log(`1`);
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", async (error, payload) => {
      if (error) {
        console.log(`2`);
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userID;
        next();
      }
    });
  }
};

// get tweets feed
app.get(
  "/user/tweets/feed/",
  tokenAuthentication,
  async (request, response) => {
    const { username, userId } = request;
    // console.log(username);
    // console.log(userId);
    const getUserTweetsFeedQuery = `
    SELECT T.username, tweet.tweet, tweet.date_time AS dateTime FROM (user INNER JOIN 
    follower ON user.user_id =  follower.following_user_id) AS T
    INNER JOIN tweet ON T.following_user_id = tweet.user_id
    WHERE
    T.follower_user_id = '${userId}'
    ORDER BY tweet.date_time DESC
    LIMIT 4;`;
    const tweetsFeedArray = await db.all(getUserTweetsFeedQuery);
    response.send(tweetsFeedArray);
  }
);

// get user following names
app.get("/user/following/", tokenAuthentication, async (request, response) => {
  const { username, userId } = request;

  //   console.log(username);
  //   console.log(userId);

  const getUserFollowingQuery = `
    SELECT T.username AS name FROM (user INNER JOIN 
    follower ON user.user_id =  follower.following_user_id) AS T 
    WHERE
    T.follower_user_id = '${userId}';`;
  const userFollowingArray = await db.all(getUserFollowingQuery);
  response.send(userFollowingArray);
});

// get user followers names
app.get("/user/followers/", tokenAuthentication, async (request, response) => {
  const { username, userId } = request;

  const getUserFollowingQuery = `
    SELECT T.username AS name FROM (user INNER JOIN 
    follower ON user.user_id =  follower.follower_user_id) AS T
    WHERE
    T.following_user_id = '${userId}';`;
  const userFollowerArray = await db.all(getUserFollowingQuery);
  response.send(userFollowerArray);
});

const tweetRequestValidation = async (request, response, next) => {
  const { username } = request;
  const { tweetId } = request.params;

  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
  const user = await db.get(getUserQuery);

  const getTweetUser = `
  SELECT following_user_id FROM follower
  WHERE follower_user_id = '${user.user_id}'
  INTERSECT
  SELECT user_id FROM tweet 
  WHERE tweet_id = '${tweetId}';`;

  const tweetUser = await db.get(getTweetUser);
  if (tweetUser === undefined) {
    response.status(401);
    response.send(`Invalid Request`);
  } else {
    next();
  }
};

// get tweet
app.get(
  "/tweets/:tweetId/",
  tokenAuthentication,
  tweetRequestValidation,
  async (request, response) => {
    const { tweetId } = request.query;

    const getTweetQuery = `
  SELECT DISTINCT tweet, COUNT(like_id) AS likes, DISTINCT(reply_id) AS replies, 
  DISTINCT(date_time) AS dateTime FROM (tweet INNER JOIN reply ON 
  tweet.tweet_id = reply.tweet_id) AS T INNER JOIN like ON 
  T.tweet_id = like.tweet_id
  WHERE T.tweet_id = '${tweetId}'`;
    const tweet = await db.all(getTweetQuery);

    response.send(tweet);
  }
);

// get tweet likes
app.get(
  "/tweets/:tweetId/likes/",
  tokenAuthentication,
  tweetRequestValidation,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikeUser = `
    SELECT username FROM user INNER JOIN 
    like on user.user_id = like.user_id
    WHERE tweet_id = '${tweetId}';`;
    const likeUserArray = await db.all(getLikeUser);
    response.send({ likeUserArray });
  }
);

const convertResObjToTweetObj = (resObj) => {
  const dateTime = new Date(resObj.dateTime);
  const date = format(dateTime, "yyyy-M-d HH:mm:ss");
  //   console.log(date);
  resObj.dateTime = date;
  return resObj;
};

// get user tweets
app.get("/user/tweets/", tokenAuthentication, async (request, response) => {
  const { username, userId } = request;
  const getUserTweetsQuery = `
    SELECT tweet, COUNT(DISTINCT like.user_id) AS likes, COUNT(DISTINCT reply.user_id) AS replies, 
    date_time AS dateTime FROM (tweet INNER JOIN like ON
    tweet.tweet_id = like.tweet_id) AS T INNER JOIN reply ON 
    tweet.tweet_id = reply.tweet_id  
    WHERE tweet.user_id = '${userId}'
    GROUP BY tweet;`;
  const tweets = await db.all(getUserTweetsQuery);
  response.send(tweets.map(convertResObjToTweetObj));
});

module.exports = app;
