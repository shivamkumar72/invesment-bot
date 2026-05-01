import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split

csv_path = 'sample_stock_data.csv'

try:
    df = pd.read_csv(csv_path, parse_dates=['date'])
except FileNotFoundError:
    print(f'Could not find {csv_path}. Place a CSV with columns: date,open,high,low,close,volume')
    raise

# Use prior close values to predict the next day close.
df['prev_close'] = df['close'].shift(1)
df = df.dropna()

X = df[['prev_close']]
y = df['close']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
model = LinearRegression()
model.fit(X_train, y_train)

score = model.score(X_test, y_test)
print(f'Linear Regression R^2 score: {score:.4f}')

last_close = df['close'].iloc[-1]
prediction = model.predict([[last_close]])[0]
print(f'Last close: {last_close:.2f}')
print(f'Predicted next close: {prediction:.2f}')
