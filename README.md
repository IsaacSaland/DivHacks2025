# SnapChef

## Build DB
`cd ./DivHacks2025/recipe_db`

Download [food.com dataset](https://www.kaggle.com/datasets/shuyangli94/food-com-recipes-and-user-interactions).


`py ./buildDB.py`
(Creates recipe_db\foodcom.db)

## Start server
`cd ./DivHacks2025/recipe_db`

`node ./server.js`


## Run guide
First `cd ./snap-chef`, then: 
- dev server: `ionic serve`
- build: `ionic build`
- ios: `ionic cap open ios` or `ionic cap run ios`
- android: `ionic cap open android` or `ionic cap run android`
